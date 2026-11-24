"""An Illustrator-style PDF-compatible .ai: optional-content layers, form XObjects, clip groups,
embedded subset TrueType fonts (Identity-H) with ToUnicode, shaped Arabic in visual order,
tracking/horizontal scale, gradients (sh + pattern), spot and CMYK colours, an image with SMask,
two artboards of different sizes with an offset crop box."""
import io, sys, zlib
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools import subset

import os
# Run as `python3 illustrator.py illustrator-box.ai` with fontTools and uharfbuzz installed;
# FreeSans comes from GNU FreeFont (fonts-freefont-ttf).
FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'fonts') + '/'
FF = '/usr/share/fonts/truetype/freefont/'

class PDF:
    def __init__(self): self.objs = []
    def add(self, body):
        self.objs.append(body); return len(self.objs)
    def reserve(self):
        self.objs.append(None); return len(self.objs)
    def set(self, ref, body): self.objs[ref-1] = body
    def stream(self, data, extra='', compress=True):
        if isinstance(data, str): data = data.encode('latin-1')
        if compress:
            data = zlib.compress(data); extra += ' /Filter /FlateDecode'
        return self.add(b'<< /Length %d %s >>\nstream\n' % (len(data), extra.encode()) + data + b'\nendstream')
    def write(self, root, path, header=b'%PDF-1.6\n%\xe2\xe3\xcf\xd3\n'):
        out = io.BytesIO(); out.write(header); offs = []
        for i, o in enumerate(self.objs):
            offs.append(out.tell())
            if isinstance(o, str): o = o.encode('latin-1')
            out.write(b'%d 0 obj\n' % (i+1) + o + b'\nendobj\n')
        x = out.tell()
        out.write(b'xref\n0 %d\n0000000000 65535 f \n' % (len(self.objs)+1))
        for o in offs: out.write(b'%010d 00000 n \n' % o)
        out.write(b'trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(self.objs)+1, root, x))
        open(path, 'wb').write(out.getvalue())

class Font:
    """A TrueType font embedded as Type0/CIDFontType2 Identity-H, subset keeping glyph ids."""
    def __init__(self, path, name):
        self.path, self.name = path, name
        self.blob = hb.Blob.from_file_path(path); self.face = hb.Face(self.blob); self.hbfont = hb.Font(self.face)
        self.upem = self.face.upem
        self.tt = TTFont(path)
        self.used = {}   # gid -> unicode string for ToUnicode
    def shape(self, text, direction=None, features=None):
        buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
        if direction: buf.direction = direction
        hb.shape(self.hbfont, buf, features or {})
        out = []
        infos, poss = buf.glyph_infos, buf.glyph_positions
        # cluster text (logical) for ToUnicode on the first glyph of each cluster
        clusters = sorted({i.cluster for i in infos}) + [len(text)]
        for info, pos in zip(infos, poss):
            out.append((info.codepoint, info.cluster, pos.x_advance, pos.x_offset, pos.y_offset))
        return out, clusters
    def width(self, gid):
        return self.tt['hmtx'].metrics[self.tt.getGlyphOrder()[gid]][0] * 1000 / self.upem
    def embed(self, pdf):
        opts = subset.Options(); opts.retain_gids = True; opts.notdef_outline = True; opts.layout_features = []
        opts.name_IDs = ['*']; opts.drop_tables += ['GSUB','GPOS','GDEF']
        font = TTFont(self.path); s = subset.Subsetter(opts)
        s.populate(gids=sorted(self.used)); s.subset(font)
        b = io.BytesIO(); font.save(b); data = b.getvalue()
        ff = pdf.stream(data, '/Length1 %d' % len(data))
        bbox = self.tt['head']; sc = 1000/self.upem
        desc = pdf.add('<< /Type /FontDescriptor /FontName /%s /Flags 4 /FontBBox [%d %d %d %d] /ItalicAngle 0 /Ascent %d /Descent %d /CapHeight 700 /StemV 80 /FontFile2 %d 0 R >>' % (
            self.name, bbox.xMin*sc, bbox.yMin*sc, bbox.xMax*sc, bbox.yMax*sc, self.tt['hhea'].ascent*sc, self.tt['hhea'].descent*sc, ff))
        ws = ' '.join('%d [%d]' % (g, round(self.width(g))) for g in sorted(self.used))
        cid = pdf.add('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /%s /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor %d 0 R /W [%s] /CIDToGIDMap /Identity >>' % (self.name, desc, ws))
        lines = []
        for g, u in sorted(self.used.items()):
            # Glyphs after a cluster's first map to nothing, as Adobe and Chromium write them.
            hexu = '0000' if u is None else ''.join('%04X' % ord(c) if ord(c) < 0x10000 else '' for c in u)
            lines.append('<%04X> <%s>' % (g, hexu))
        cmap = ('/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n'
                + '%d beginbfchar\n%s\nendbfchar\nendcmap CMapName currentdict /CMap defineresource pop end end' % (len(lines), '\n'.join(lines)))
        tu = pdf.stream(cmap)
        return pdf.add('<< /Type /Font /Subtype /Type0 /BaseFont /%s /Encoding /Identity-H /DescendantFonts [%d 0 R] /ToUnicode %d 0 R >>' % (self.name, cid, tu))

def hexgid(g): return '<%04X>' % g

def latin_tj(font, text, kern=True):
    """TJ array with kerning adjustments, like Illustrator writes Latin."""
    glyphs, clusters = font.shape(text, features={'kern': kern})
    parts = []
    for gid, cl, adv, xo, yo in glyphs:
        font.used.setdefault(gid, text[cl])
        natural = font.width(gid)
        actual = adv * 1000 / font.upem
        parts.append(hexgid(gid))
        if abs(natural - actual) > 0.5: parts.append('%d' % round(natural - actual))
    return '[' + ' '.join(parts) + ']'

def arabic_glyphs(font, text, size, x_right, y, presentation=False):
    """Shaped RTL text as per-glyph Tm moves in visual order (glyphs left to right), the way
    Illustrator's Middle Eastern composer positions them. ToUnicode maps each cluster's first
    glyph to the cluster's logical characters, or to presentation forms when asked."""
    glyphs, clusters = font.shape(text)
    total = sum(g[2] for g in glyphs) * size / font.upem
    x = x_right - total
    ops = []
    # harfbuzz gives RTL output in visual order already (left to right). A cluster drawn with
    # more than one glyph is wrapped in an ActualText span, as Adobe's composers write it; each
    # glyph maps to its own character in the ToUnicode CMap, or to nothing.
    by_cluster = {}
    for g in glyphs: by_cluster.setdefault(g[1], []).append(g)
    open_cluster = None
    for gid, cl, adv, xo, yo in glyphs:
        nxt = min([c for c in clusters if c > cl])
        ctext = text[cl:nxt]
        multi = len(by_cluster[cl]) > 1
        if multi and open_cluster != cl:
            if open_cluster is not None: ops.append('EMC')
            utf16 = 'FEFF' + ''.join('%04X' % ord(c) for c in ctext)
            ops.append('/Span << /ActualText <%s> >> BDC' % utf16)
            open_cluster = cl
        elif not multi and open_cluster is not None:
            ops.append('EMC'); open_cluster = None
        if multi: font.used.setdefault(gid, None)
        else: font.used[gid] = ctext
        gx = x + xo * size / font.upem
        gy = y + yo * size / font.upem
        ops.append('1 0 0 1 %.3f %.3f Tm %s Tj' % (gx, gy, hexgid(gid)))
        x += adv * size / font.upem
    if open_cluster is not None: ops.append('EMC')
    return '\n'.join(ops)

pdf = PDF()
catalog = pdf.reserve(); pages = pdf.reserve()
naskh = Font(FONTS + 'NotoNaskhArabic-Regular.ttf', 'ABCDEF+NotoNaskhArabic-Regular')
sansb = Font(FF + 'FreeSansBold.ttf', 'GHIJKL+FreeSans-Bold')
sans = Font(FF + 'FreeSans.ttf', 'MNOPQR+FreeSans')

# OCG layers
ocg_bg = pdf.add('<< /Type /OCG /Name (Background) >>')
ocg_text = pdf.add('<< /Type /OCG /Name (Text) >>')
ocg_guides = pdf.add('<< /Type /OCG /Name (Guides) >>')

# Separation spot colour: PANTONE 185 C, tint -> CMYK
spot = '[/Separation /PANTONE#20185#20C /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 0.91 0.76 0] /N 1 >>]'
cs_spot = pdf.add(spot)

# Shadings
sh_axial = pdf.add('<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 260 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [0.784 0.063 0.18] /C1 [1 0.8 0] /N 1 >> /Extend [true true] >>')
sh_radial = pdf.add('<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [50 50 0 50 50 50] /Function << /FunctionType 2 /Domain [0 1] /C0 [0 0.67 1] /C1 [0 0.2 0.4] /N 1 >> /Extend [true true] >>')
pat_radial = pdf.add('<< /Type /Pattern /PatternType 2 /Shading %d 0 R /Matrix [1 0 0 1 1000 30] >>' % sh_radial)

# Image with SMask (gradient alpha)
w, h = 32, 24
rgb = bytes(b for y in range(h) for x in range(w) for b in (int(255*x/w), int(255*y/h), 160))
alpha = bytes(int(255*(x/w)) for y in range(h) for x in range(w))
smask = pdf.stream(alpha, '/Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8' % (w, h))
img = pdf.stream(rgb, '/Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask %d 0 R' % (w, h, smask))

# Form XObject: the red panel with a stray-looking curve clipped inside it (a clip group)
form_content = '''
0.784 0.063 0.18 rg 0 0 420 151 re f
q 0 0 420 151 re W n
1 1 1 RG 0.6 w 20 20 m 120 50 300 0 520 40 c S
Q
'''
form = pdf.stream(form_content, '/Type /XObject /Subtype /Form /BBox [0 0 420 151] /Matrix [1 0 0 1 0 0] /Resources << >>')

ar1 = arabic_glyphs(naskh, 'القِمَّة للمُقاوَلات', 34, 728, 75)
ar2 = arabic_glyphs(naskh, 'لا إله إلا الله', 22, 728, 30)
latin = latin_tj(sansb, 'ALQIMMAC')
mirrored = latin_tj(sans, 'Flipped')
rot = latin_tj(sans, 'Rotated 30')
mixed_ar = arabic_glyphs(naskh, 'شركة', 26, 1180, 70)
mixed_lat = latin_tj(sans, 'ALQIMMAC 2024')

content1 = f'''
/OC /MC0 BDC
q 1 0 0 1 0 0 cm /Fm0 Do Q
q 3 w /CS0 CS 1 SCN 441.5 16.5 297 118 re S Q
q 0 0 0 0.2 k 760 10 150 130 re f Q
EMC
/OC /MC1 BDC
BT /F1 54 Tf 6 Tc 105 Tz 1 1 1 rg 1 0 0 1 30 52 Tm {latin} TJ ET
BT /F3 0 Tf 0 Tc 100 Tz 0.784 0.063 0.18 rg /F3 1 Tf 0 Tc
ET
BT /F3 1 Tf 0.784 0.063 0.18 rg
{ar1.replace(' Tj', ' Tj').replace('Tm', 'Tm')}
ET
BT 0.2 0.2 0.2 rg /F3 1 Tf
{ar2}
ET
q 0.866 0.5 -0.5 0.866 800 40 cm 0.1 0.3 0.8 rg 0 0 80 40 re f
BT /F2 14 Tf 1 1 1 rg 1 0 0 1 6 14 Tm {rot} TJ ET Q
q -1 0 0 1 900 0 cm BT /F2 16 Tf 0 0 0 rg 1 0 0 1 -10 120 Tm {mirrored} TJ ET Q
q 930 25 m 1190 25 l 1190 125 l 930 125 l h W n q 1 0 0 1 930 0 cm /Sh0 sh Q Q
BT /F2 22 Tf 1 1 1 rg 1 0 0 1 945 66 Tm {mixed_lat} TJ ET
BT /F3 1 Tf 1 1 1 rg
{mixed_ar}
ET
EMC
/OC /MC2 BDC
0 1 1 RG 0.5 w 0 75 m 1221 75 l S
EMC
'''
# Tf size 1 with Tm carrying size: Illustrator scales the text matrix
ar_fixed = []
for line in content1.split('\n'):
    ar_fixed.append(line)
content1 = '\n'.join(ar_fixed)
# Arabic glyph Tm lines need the font size in the matrix: rewrite "1 0 0 1 x y Tm" under /F3 1 Tf
def scale_tm(block, size):
    out = []
    for l in block.split('\n'):
        p = l.split()
        if len(p) >= 8 and p[6] == 'Tm':
            out.append('%s 0 0 %s %s %s Tm %s Tj' % (size, size, p[4], p[5], p[7]))
        else: out.append(l)
    return '\n'.join(out)
content1 = content1.replace(ar1, scale_tm(ar1, 34)).replace(ar2, scale_tm(ar2, 22)).replace(mixed_ar, scale_tm(mixed_ar, 26))

content2 = f'''
q 0.9 0.9 0.95 rg 50 50 500 300 re f Q
q 80 80 m 300 80 l 300 300 l 80 300 l h W n
q 220 0 0 220 80 80 cm /Im0 Do Q Q
q /Pattern cs /P0 scn 320 80 200 120 re f Q
q 1 0 0 1 320 220 cm 0 0 0 1 k
BT /F2 18 Tf 1 0 0 1 0 60 Tm (A) Tj ET Q
q 0.5 0 0 0.5 330 250 cm 0 0.6 0.3 rg 0 0 100 100 re f
q 0 0.5 -0.5 0 120 0 cm 1 0.5 0 rg 0 0 80 40 re f Q Q
BT /F2 20 Tf 0.1 0.1 0.1 rg 1 0 0 1 330 330 Tm 3 Ts (Raised) Tj 0 Ts ( base) Tj ET
'''
# "(A) Tj" uses a CID font: encode as hex glyph
def lit(font, s):
    gl, _ = font.shape(s)
    for gid, cl, *_ in gl: font.used.setdefault(gid, s[cl])
    return '<' + ''.join('%04X' % g[0] for g in gl) + '>'
content2 = content2.replace('(A) Tj', lit(sans, 'A') + ' Tj').replace('(Raised) Tj', lit(sans, 'Raised') + ' Tj').replace('( base) Tj', lit(sans, ' base') + ' Tj')

f1 = sansb.embed(pdf); f2 = sans.embed(pdf); f3 = naskh.embed(pdf)
fonts = '/Font << /F1 %d 0 R /F2 %d 0 R /F3 %d 0 R >>' % (f1, f2, f3)
res1 = pdf.add('<< %s /XObject << /Fm0 %d 0 R >> /ColorSpace << /CS0 %d 0 R >> /Shading << /Sh0 %d 0 R >> /Properties << /MC0 %d 0 R /MC1 %d 0 R /MC2 %d 0 R >> >>' % (fonts, form, cs_spot, sh_axial, ocg_bg, ocg_text, ocg_guides))
res2 = pdf.add('<< %s /XObject << /Im0 %d 0 R >> /Pattern << /P0 %d 0 R >> >>' % (fonts, img, pat_radial))
c1 = pdf.stream(content1); c2 = pdf.stream(content2)
priv = pdf.stream('%AI24_ZStandard_Data private Illustrator data stand-in', compress=False)
pi = '/PieceInfo << /Illustrator << /LastModified (D:20241101120000Z) /Private << /AIMetaData %d 0 R >> >> >> /LastModified (D:20241101120000Z)' % priv
p1 = pdf.add('<< /Type /Page /Parent %d 0 R /MediaBox [0 0 1221 151] /ArtBox [0 0 1221 151] /TrimBox [0 0 1221 151] /Resources %d 0 R /Contents %d 0 R %s >>' % (pages, res1, c1, pi))
p2 = pdf.add('<< /Type /Page /Parent %d 0 R /MediaBox [0 0 600 400] /CropBox [50 50 550 350] /Resources %d 0 R /Contents %d 0 R %s >>' % (pages, res2, c2, pi))
pdf.set(pages, '<< /Type /Pages /Kids [%d 0 R %d 0 R] /Count 2 >>' % (p1, p2))
pdf.set(catalog, '<< /Type /Catalog /Pages %d 0 R /OCProperties << /OCGs [%d 0 R %d 0 R %d 0 R] /D << /Order [%d 0 R %d 0 R %d 0 R] /OFF [%d 0 R] /RBGroups [] >> >> >>' % (pages, ocg_bg, ocg_text, ocg_guides, ocg_bg, ocg_text, ocg_guides, ocg_guides))
pdf.write(catalog, sys.argv[1])
print('ok')
