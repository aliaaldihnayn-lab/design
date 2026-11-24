/**
 * Copy of the home page (`/` in Arabic, `/en` in English). Every claim is something the app does
 * today: each feature section names the work it shows in its screenshot, taken from the app with
 * Arabic content, and lists only capabilities recorded in `changes/` and the README.
 */

export const RELEASE_URL =
  'https://github.com/aliaaldihnayn-lab/design/releases/tag/desktop-preview'
export const WEB_APP_URL = 'https://lawha-aliaaldihnayn-4860.vercel.app'
export const SOURCE_URL = 'https://github.com/aliaaldihnayn-lab/design'

export type HomeLocale = 'ar' | 'en'

/** The screenshot a section shows: `public/home/<shot>-<locale>-<width>.webp`. */
export type HomeShot =
  | 'canvas'
  | 'vector'
  | 'paint'
  | 'publisher'
  | 'formats'
  | 'prototype'
  | 'inspect'
  | 'writer'
  | 'history'
  | 'stories'
  | 'ai'

export interface HomeFeature {
  id: string
  shot: HomeShot
  eyebrow: string
  title: string
  body: string
  points: string[]
  alt: string
}

export interface HomePlatform {
  name: string
  detail: string
}

export interface HomeMessages {
  dir: 'rtl' | 'ltr'
  skip: string
  nav: { features: string; platforms: string; docs: string; source: string; menu: string }
  switchLabel: string
  switchTo: string
  hero: {
    title: string
    lead: string
    download: string
    web: string
    note: string
    alt: string
  }
  featuresTitle: string
  features: HomeFeature[]
  platforms: {
    title: string
    lead: string
    items: HomePlatform[]
    download: string
    web: string
    mobileAlt: string
    note: string
  }
  footer: { tagline: string; docs: string; download: string; source: string }
}

export const ar: HomeMessages = {
  dir: 'rtl',
  skip: 'انتقل إلى المحتوى',
  nav: {
    features: 'المزايا',
    platforms: 'التنزيل',
    docs: 'التوثيق',
    source: 'الشيفرة المصدرية',
    menu: 'التنقل الرئيسي'
  },
  switchLabel: 'English',
  switchTo: 'Read this page in English',
  hero: {
    title: 'لوحة: محرّر تصميم عربي أولاً',
    lead: 'صمّم الواجهات والمطبوعات ومنشورات التواصل الاجتماعي في محرّر واحد بواجهة عربية كاملة من اليمين إلى اليسار، مع ذكاء اصطناعي مدمج. يعمل في المتصفح، وعلى سطح المكتب، وعلى أندرويد.',
    download: 'نزّل النسخة التجريبية',
    web: 'افتح في المتصفح',
    note: 'قيد التطوير النشط ولم يصدر رسمياً بعد. النسخ التجريبية تحدّث نفسها.',
    alt: 'محرّر لوحة بواجهته العربية وعليه ملصق «معرض التصميم العربي» محدَّداً، وبطاقة تطبيق قهوة بجانبه'
  },
  featuresTitle: 'كل ما في لوحة',
  features: [
    {
      id: 'canvas',
      shot: 'canvas',
      eyebrow: 'التصميم والتحرير',
      title: 'لوحة رسم تفهم العربية',
      body: 'تشكيل عربي صحيح ونص ثنائي الاتجاه، وتخطيط تلقائي يتدفق من اليمين إلى اليسار، ومحاذاة تطابق أزرار المحاذاة. تفتح ملفات ‎.fig‎ وتحرّرها وتحفظها.',
      points: [
        'تخطيط تلقائي بالصفوف والأعمدة والشبكة',
        'خطوط Google كاملة، ومنها Cairo وTajawal وAlmarai وAmiri',
        'تكييف التصميم للشاشات ومقاسات التواصل الاجتماعي بنقرة'
      ],
      alt: 'ملصق عربي محدَّد على لوحة الرسم ولوحة الخصائص العربية تعرض التخطيط التلقائي من اليمين إلى اليسار'
    },
    {
      id: 'vector',
      shot: 'vector',
      eyebrow: 'أدوات Illustrator',
      title: 'متجهات بأدوات المحترفين',
      body: 'منشئ الأشكال يدمج مناطق الأشكال المتداخلة أو يحذفها، وللمتجهات إعدادات التشويه وشبكة الغلاف وإزاحة المسار وملفات العرض والمزج وتعبئات النقش.',
      points: [
        'منشئ الأشكال وأداة العرض',
        'التشويه والمزج والنقوش',
        'تتبّع الصور إلى متجهات على الجهاز، دون مزوّد خارجي'
      ],
      alt: 'دائرتان ونجمة متداخلة محدَّدة وأداة منشئ الأشكال نشطة'
    },
    {
      id: 'paint',
      shot: 'paint',
      eyebrow: 'أدوات Affinity',
      title: 'رسم بكسلي وتحديد وأقنعة',
      body: 'ارسم على طبقات الصور بالفرشاة والممحاة ودلو التعبئة وأداة اختيار اللون، وحدّد بالمستطيل والشكل البيضاوي والعصا السحرية، وأنشئ قناعاً من التحديد، ورمّم بختم النسخ وفرشاة المعالجة.',
      points: [
        'تعديلات غير متلفة ومستويات ومنحنيات',
        'إزالة الخلفية على الجهاز بنقرة',
        'ختم النسخ وفرشاة المعالجة'
      ],
      alt: 'ضربة فرشاة سوداء مرسومة فوق صورة متدرجة وخيارات الفرشاة ظاهرة أسفلها'
    },
    {
      id: 'publisher',
      shot: 'publisher',
      eyebrow: 'النشر',
      title: 'مستندات متعددة الصفحات',
      body: 'صفحات رئيسية، ونص متسلسل عبر الإطارات، وترقيم تلقائي للصفحات. ومكتبة منتجات طباعة جاهزة للمطبعة بمقاساتها الحقيقية والنزيف والمنطقة الآمنة وخط القص.',
      points: [
        'صفحات رئيسية وترقيم تلقائي',
        'نص متسلسل بين الإطارات',
        'بطاقات أعمال ومطويات وملصقات ورول أب بخطوط قص'
      ],
      alt: 'لوحة المنشور في لوحة تعرض إعدادات الصفحات وترتيبها'
    },
    {
      id: 'formats',
      shot: 'formats',
      eyebrow: 'الفتح والتصدير',
      title: 'يفتح ملفاتك ويصدّر لكل وجهة',
      body: 'افتح ‎.fig‎ وPSD وPDF وIllustrator ‏(AI) وPowerPoint طبقاتٍ قابلة للتحرير، واستورد SVG وHTML وdraw.io. وصدّر إلى PNG وJPG وWebP وSVG وPPTX وPSD وHTML وdraw.io و‎.fig‎، وإلى PDF/X بألوان CMYK للطباعة.',
      points: [
        'PDF/X بألوان CMYK مع النزيف وعلامات القص',
        'محرّر مستندات يفتح ملفات Word ويحفظها',
        'تصدير JSX وTailwind ورموز التصميم'
      ],
      alt: 'قائمة ملف مفتوحة على «تصدير التحديد» وصيغه: PNG وJPG وWebP وSVG وPPTX وPDF/X ‏(CMYK) وdraw.io و‎.fig'
    },
    {
      id: 'prototype',
      shot: 'prototype',
      eyebrow: 'النماذج التفاعلية',
      title: 'نماذج تعمل كأنها التطبيق',
      body: 'اربط الشاشات بالنقر والمرور والضغط والتأخير والمفاتيح، مع انتقالات وSmart Animate. المكوّنات التفاعلية تشغّل حالاتها مباشرة، وطقم المكوّنات الحية يضع عناصر تحكم جاهزة بكل حالاتها.',
      points: [
        'ربط الشاشات تلقائياً بأزرار التالي والرجوع',
        'متغيرات النموذج والشروط',
        'طقم مكوّنات حية يدعم الاتجاه من اليمين إلى اليسار'
      ],
      alt: 'شاشتا تطبيق قهوة بالعربية يربط بينهما سهم انتقال من زر «التالي»'
    },
    {
      id: 'inspect',
      shot: 'inspect',
      eyebrow: 'نظام التصميم ووضع المطوّر',
      title: 'من التصميم إلى الشيفرة',
      body: 'ابنِ نظام تصميم من تصميمك بنقرة: أنماط ألوان ونصوص، ومتغيرات للوضع الداكن، ومجموعات مكوّنات بمتغيراتها. ولوحة الفحص تعرض كل طبقة بـCSS وSwiftUI وJetpack Compose.',
      points: [
        'متغيرات وأنماط مربوطة بالطبقات',
        'CSS وSwiftUI وCompose',
        'حزمة تسليم لـClaude Code مع مدقق بكسلات'
      ],
      alt: 'لوحة الفحص تعرض أبعاد بطاقة القهوة وشيفرة CSS الخاصة بها'
    },
    {
      id: 'writer',
      shot: 'writer',
      eyebrow: 'المستندات والتوقيع',
      title: 'محرّر مستندات وتوقيع رقمي',
      body: 'افتح مستندات Word واحفظها في مكانها، مع إعداد الصفحة والرؤوس والتذييلات وتتبّع التغييرات والتعليقات وجدول المحتويات والحواشي والتصدير إلى PDF. ووقّع بالرسم أو الكتابة أو الرفع، ووقّع ملفات PDF توقيعاً رقمياً بمعيار PAdES.',
      points: ['تتبّع التغييرات والتعليقات', 'حقول قابلة للتعبئة وقوالب', 'توقيع PAdES للـPDF'],
      alt: 'محرّر المستندات وفيه عقد تصميم مكتوب بالعربية'
    },
    {
      id: 'history',
      shot: 'history',
      eyebrow: 'الغرف والتعاون والإصدارات',
      title: 'اعملوا معاً، وارجعوا لأي إصدار',
      body: 'غرف تعاون مباشرة بين الأجهزة عبر WebRTC، وغرف Lawha Cloud بالأعضاء والصلاحيات والدعوات. وسجل إصدارات يحفظ كل تعديل والإصدارات التلقائية والمسمّاة، مع المعاينة والمقارنة والاستعادة.',
      points: [
        'مؤشرات وتحديدات المشاركين مباشرة',
        'إصدارات مسمّاة وتلقائية',
        'مقارنة واستعادة ونسخ'
      ],
      alt: 'لوحة سجل الإصدارات بجانب الملصق العربي'
    },
    {
      id: 'stories',
      shot: 'stories',
      eyebrow: 'قصص المستخدم وJira',
      title: 'المواصفات تعيش مع التصميم',
      body: 'أرفق قصص المستخدم والملاحم بالطبقات، بمعايير القبول والحالات والأولوية، وصدّرها Markdown أو CSV، وزامنها قضايا في Jira.',
      points: [
        'تبويب القصص ودبابيس على لوحة الرسم',
        'صياغة القصص بالذكاء الاصطناعي ومراجعتها قبل الحفظ',
        'مزامنة باتجاهين مع Jira'
      ],
      alt: 'تبويب القصص يعرض قصة «طلب قهوة بنقرة» في ملحمة «الطلب السريع» لشاشة تطبيق'
    },
    {
      id: 'ai',
      shot: 'ai',
      eyebrow: 'الذكاء الاصطناعي وMCP',
      title: 'دع Claude يصمّم داخل لوحة',
      body: 'محادثة مدمجة بأدوات تحرير، وخادم MCP يتيح لوكلاء البرمجة مثل Claude Code قراءة التصميم المفتوح وتحريره، وواجهة برمجة متوافقة مع إضافات Figma. أحضر مفتاح المزوّد الذي تختاره.',
      points: [
        'خادم MCP وCLI',
        'تشغيل إضافات Figma بواجهتها',
        'الذكاء الاصطناعي يقرأ القصص والإصدارات وقضايا Jira'
      ],
      alt: 'تبويب الذكاء الاصطناعي في لوحة يدعو إلى ربط مزوّد'
    }
  ],
  platforms: {
    title: 'سطح المكتب وأندرويد والويب',
    lead: 'نفس المحرّر في كل مكان، بالعربية أولاً. تطبيقات سطح المكتب وأندرويد تحدّث نفسها من الإصدار التجريبي، ونسخة الويب دائماً الأحدث.',
    items: [
      { name: 'macOS', detail: 'Apple Silicon وIntel' },
      { name: 'Windows', detail: 'مثبّت ‎.exe‎' },
      { name: 'Android', detail: 'ملف APK للهواتف والأجهزة اللوحية' },
      { name: 'الويب', detail: 'في المتصفح دون تثبيت' }
    ],
    download: 'صفحة الإصدار التجريبي',
    web: 'افتح نسخة الويب',
    mobileAlt: 'لوحة على هاتف: الملصق العربي محدَّد مع شريط أدوات اللمس',
    note: 'النسخ التجريبية لم تُوثَّق بعد لدى Apple ولا تحمل توقيع Windows؛ تشرح صفحة الإصدار كيف تفتحها.'
  },
  footer: {
    tagline: 'لوحة: محرّر تصميم مفتوح المصدر، عربي أولاً.',
    docs: 'التوثيق',
    download: 'التنزيل',
    source: 'GitHub'
  }
}

export const en: HomeMessages = {
  dir: 'ltr',
  skip: 'Skip to content',
  nav: {
    features: 'Features',
    platforms: 'Download',
    docs: 'Docs',
    source: 'Source',
    menu: 'Main navigation'
  },
  switchLabel: 'العربية',
  switchTo: 'اقرأ هذه الصفحة بالعربية',
  hero: {
    title: 'Lawha: the Arabic-first design editor',
    lead: 'Design interfaces, print and social media in one editor with a complete right-to-left Arabic interface and built-in AI. Runs in the browser, on the desktop and on Android.',
    download: 'Download the preview',
    web: 'Open in the browser',
    note: 'In active development and not yet released. Preview builds update themselves.',
    alt: 'The Lawha editor in Arabic with the “Arabic Design Expo” poster selected and a coffee app card beside it'
  },
  featuresTitle: 'Everything in Lawha',
  features: [
    {
      id: 'canvas',
      shot: 'canvas',
      eyebrow: 'Design and editing',
      title: 'A canvas that understands Arabic',
      body: 'Correct Arabic shaping and bidirectional text, auto layout that flows right to left, and alignment that matches the alignment buttons. Opens, edits and saves .fig files.',
      points: [
        'Auto layout in rows, columns and grids',
        'The whole Google Fonts catalogue, Cairo, Tajawal, Almarai and Amiri included',
        'Adapt a design to screens and social sizes in one click'
      ],
      alt: 'An Arabic poster selected on the canvas, with the properties panel showing right-to-left auto layout'
    },
    {
      id: 'vector',
      shot: 'vector',
      eyebrow: 'Illustrator tools',
      title: 'Vectors with professional tools',
      body: 'The Shape Builder merges and removes regions of overlapping shapes, and vectors gain Warp presets, an envelope mesh, offset path, width profiles, blends and pattern fills.',
      points: [
        'Shape Builder and the Width tool',
        'Warp, blends and patterns',
        'Image Trace turns images into vectors on the device, without a provider'
      ],
      alt: 'Two circles and an overlapping star selected with the Shape Builder tool active'
    },
    {
      id: 'paint',
      shot: 'paint',
      eyebrow: 'Affinity tools',
      title: 'Pixel painting, selections and masks',
      body: 'Paint image layers with a brush, eraser, fill bucket and color picker, select with rectangle, ellipse and magic wand selections, mask from a selection, and retouch with the clone stamp and healing brush.',
      points: [
        'Non-destructive adjustments, levels and curves',
        'One-click background removal on the device',
        'Clone stamp and healing brush'
      ],
      alt: 'A black brush stroke painted over a gradient image, with the brush options below it'
    },
    {
      id: 'publisher',
      shot: 'publisher',
      eyebrow: 'Publishing',
      title: 'Multi-page documents',
      body: 'Master pages, text threaded across frames and automatic page numbers. A print product library is ready for the press, with real sizes, bleed, safe area and a die-line.',
      points: [
        'Master pages and automatic page numbers',
        'Text threaded between frames',
        'Business cards, brochures, posters and roll-ups with die-lines'
      ],
      alt: 'The Publication panel in Lawha with page settings and order'
    },
    {
      id: 'formats',
      shot: 'formats',
      eyebrow: 'Open and export',
      title: 'Opens your files, exports for every destination',
      body: 'Open .fig, PSD, PDF, Illustrator (AI) and PowerPoint files as editable layers, and import SVG, HTML and draw.io. Export PNG, JPG, WebP, SVG, PPTX, PSD, HTML, draw.io and .fig, and press-ready CMYK PDF/X.',
      points: [
        'CMYK PDF/X with bleed and crop marks',
        'A document editor that opens and saves Word files',
        'JSX, Tailwind and design token export'
      ],
      alt: 'The File menu open on “Export selection” with PNG, JPG, WebP, SVG, PPTX, PDF/X (CMYK), draw.io and .fig'
    },
    {
      id: 'prototype',
      shot: 'prototype',
      eyebrow: 'Prototyping',
      title: 'Prototypes that behave like the app',
      body: 'Link screens with click, hover, press, delay and key triggers, transitions and Smart Animate. Interactive components run their states live, and the live component kit places ready controls with all their states.',
      points: [
        'Auto-link Next and Back buttons',
        'Prototype variables and conditions',
        'A live component kit that lays out right to left'
      ],
      alt: 'Two Arabic coffee app screens joined by a connection from the “Next” button'
    },
    {
      id: 'inspect',
      shot: 'inspect',
      eyebrow: 'Design system and Dev Mode',
      title: 'From design to code',
      body: 'Build a design system from a design in one click: color and text styles, dark-mode variables and component sets with variants. The inspect panel shows each layer as CSS, SwiftUI and Jetpack Compose.',
      points: [
        'Variables and styles bound to layers',
        'CSS, SwiftUI and Compose',
        'A Claude Code handoff package with a pixel verifier'
      ],
      alt: 'The inspect panel showing the coffee card’s size and CSS'
    },
    {
      id: 'writer',
      shot: 'writer',
      eyebrow: 'Documents and signatures',
      title: 'A document editor with digital signatures',
      body: 'Open Word documents and save them in place, with page setup, headers and footers, track changes, comments, a table of contents, footnotes and PDF export. Sign by drawing, typing or uploading, and sign PDFs with a PAdES digital signature.',
      points: [
        'Track changes and comments',
        'Fillable fields and templates',
        'PAdES signatures for PDF'
      ],
      alt: 'The document editor with a design contract written in Arabic'
    },
    {
      id: 'history',
      shot: 'history',
      eyebrow: 'Rooms, collaboration and versions',
      title: 'Work together, return to any version',
      body: 'Peer-to-peer rooms over WebRTC, and Lawha Cloud rooms with members, access rules and invitations. Version history keeps each edit, automatic and named versions, with preview, comparison and restore.',
      points: [
        'Live cursors and selections',
        'Named and automatic versions',
        'Compare, restore and duplicate'
      ],
      alt: 'The version history panel beside the Arabic poster'
    },
    {
      id: 'stories',
      shot: 'stories',
      eyebrow: 'User stories and Jira',
      title: 'The spec lives with the design',
      body: 'Attach user stories and epics to layers, with acceptance criteria, states and priority, export them as Markdown or CSV, and keep them in sync as Jira issues.',
      points: [
        'A Stories tab and pins on the canvas',
        'AI drafts stories you review before saving',
        'Two-way sync with Jira'
      ],
      alt: 'The Stories tab showing the story “طلب قهوة بنقرة” in the epic “الطلب السريع” for an app screen'
    },
    {
      id: 'ai',
      shot: 'ai',
      eyebrow: 'AI and MCP',
      title: 'Let Claude design in Lawha',
      body: 'A built-in chat with editing tools, an MCP server that lets coding agents such as Claude Code read and edit the open design, and a Figma Plugin API–compatible scripting API. Bring your own provider key.',
      points: [
        'MCP server and CLI',
        'Figma plugins run with their UI',
        'AI reads stories, versions and Jira issues'
      ],
      alt: 'The AI tab in Lawha inviting you to connect a provider'
    }
  ],
  platforms: {
    title: 'Desktop, Android and web',
    lead: 'The same editor everywhere, Arabic first. The desktop and Android apps update themselves from the preview release, and the web app always serves the latest build.',
    items: [
      { name: 'macOS', detail: 'Apple silicon and Intel' },
      { name: 'Windows', detail: '.exe installer' },
      { name: 'Android', detail: 'APK for phones and tablets' },
      { name: 'Web', detail: 'In the browser, nothing to install' }
    ],
    download: 'Preview release page',
    web: 'Open the web app',
    mobileAlt: 'Lawha on a phone: the Arabic poster selected, with the touch toolbar',
    note: 'Preview builds are not yet notarized by Apple or code-signed for Windows; the release page explains how to open them.'
  },
  footer: {
    tagline: 'Lawha: an open-source, Arabic-first design editor.',
    docs: 'Docs',
    download: 'Download',
    source: 'GitHub'
  }
}
