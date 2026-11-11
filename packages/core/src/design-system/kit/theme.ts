import type { SceneGraph } from '@lawha/scene-graph'

/**
 * The look of the interactive kit: the document's design-system variables where it has them,
 * by the names the design-system build gives them, so the kit follows the tokens and their modes,
 * and neutral defaults otherwise. Values are design JSX attribute values, quoted or braced.
 */
export interface KitTheme {
  primary: string
  onPrimary: string
  text: string
  muted: string
  surface: string
  subtle: string
  border: string
  danger: string
  success: string
  /** Right to left: rows flow from the right and text reads right to left. */
  rtl: boolean
  font: string
  labels: KitLabels
}

export interface KitOptions {
  /** Lay the kit out right to left, with Arabic default labels. */
  rtl?: boolean
  /** The default labels' language; Arabic when right to left. */
  locale?: 'en' | 'ar'
}

const FALLBACK = {
  primary: '#4F46E5',
  onPrimary: '#FFFFFF',
  text: '#18181B',
  muted: '#71717A',
  surface: '#FFFFFF',
  subtle: '#F4F4F5',
  border: '#D4D4D8',
  danger: '#DC2626',
  success: '#16A34A'
}

/** The design-system build's variable names for each role, most specific first. */
const TOKEN_NAMES: Record<keyof typeof FALLBACK, readonly string[]> = {
  primary: ['color/primary', 'color/brand', 'primary'],
  onPrimary: ['color/on-primary', 'color/primary/foreground'],
  text: ['color/text/primary', 'color/text', 'text'],
  muted: ['color/text/secondary', 'color/text/muted'],
  surface: ['color/background', 'color/surface', 'background'],
  subtle: ['color/neutral/100', 'color/surface/subtle'],
  border: ['color/neutral/200', 'color/border', 'border'],
  danger: ['color/error', 'color/danger'],
  success: ['color/success']
}

/** The default text of the kit's controls, in English and Arabic. */
const LABELS = {
  en: {
    button: 'Continue',
    loading: 'Loading…',
    email: 'Email address',
    message: 'Write a message',
    search: 'Search',
    noResults: 'No results',
    choose: 'Choose a city',
    options: ['Riyadh', 'Jeddah', 'Dammam', 'Mecca'],
    actions: ['Edit', 'Duplicate', 'Share', 'Delete'],
    menu: 'Actions',
    tags: 'Add tags',
    tabs: ['Overview', 'Details', 'Reviews'],
    tabBody: ['Everything at a glance.', 'The full specification.', 'What people say.'],
    sections: ['Shipping', 'Returns', 'Payment'],
    sectionBody: 'Delivered in two to four working days.',
    openDialog: 'Open dialog',
    dialogTitle: 'Delete this file?',
    dialogBody: 'This cannot be undone.',
    cancel: 'Cancel',
    confirm: 'Delete',
    openDrawer: 'Open sheet',
    drawerTitle: 'Filters',
    more: 'More info',
    popover: 'Shown when you click.',
    tooltip: 'Helpful hint',
    hover: 'Hover me',
    showToast: 'Show toast',
    toast: 'Saved successfully',
    notifications: 'Notifications',
    agree: 'I agree to the terms',
    plans: ['Monthly', 'Yearly', 'Lifetime'],
    volume: 'Volume',
    price: 'Price',
    pickDate: 'Pick a date',
    pickRange: 'Pick dates',
    pickTime: 'Pick a time',
    upload: 'Drop files or click to upload',
    uploading: 'Uploading…',
    uploaded: 'report.pdf uploaded',
    steps: ['Account', 'Details', 'Review', 'Done'],
    next: 'Next',
    back: 'Back',
    slides: ['First slide', 'Second slide', 'Third slide'],
    progress: 'Progress'
  },
  ar: {
    button: 'متابعة',
    loading: 'جارٍ التحميل…',
    email: 'البريد الإلكتروني',
    message: 'اكتب رسالة',
    search: 'بحث',
    noResults: 'لا توجد نتائج',
    choose: 'اختر مدينة',
    options: ['الرياض', 'جدة', 'الدمام', 'مكة'],
    actions: ['تعديل', 'تكرار', 'مشاركة', 'حذف'],
    menu: 'إجراءات',
    tags: 'أضف وسومًا',
    tabs: ['نظرة عامة', 'التفاصيل', 'المراجعات'],
    tabBody: ['كل شيء في لمحة.', 'المواصفات الكاملة.', 'آراء العملاء.'],
    sections: ['الشحن', 'الإرجاع', 'الدفع'],
    sectionBody: 'يصل خلال يومين إلى أربعة أيام عمل.',
    openDialog: 'فتح النافذة',
    dialogTitle: 'حذف هذا الملف؟',
    dialogBody: 'لا يمكن التراجع عن ذلك.',
    cancel: 'إلغاء',
    confirm: 'حذف',
    openDrawer: 'فتح اللوحة',
    drawerTitle: 'عوامل التصفية',
    more: 'مزيد من المعلومات',
    popover: 'يظهر عند النقر.',
    tooltip: 'تلميح مفيد',
    hover: 'مرّر المؤشر هنا',
    showToast: 'إظهار إشعار',
    toast: 'تم الحفظ بنجاح',
    notifications: 'الإشعارات',
    agree: 'أوافق على الشروط',
    plans: ['شهري', 'سنوي', 'مدى الحياة'],
    volume: 'مستوى الصوت',
    price: 'السعر',
    pickDate: 'اختر تاريخًا',
    pickRange: 'اختر التواريخ',
    pickTime: 'اختر وقتًا',
    upload: 'أفلت الملفات أو انقر للرفع',
    uploading: 'جارٍ الرفع…',
    uploaded: 'تم رفع report.pdf',
    steps: ['الحساب', 'البيانات', 'المراجعة', 'تم'],
    next: 'التالي',
    back: 'السابق',
    slides: ['الشريحة الأولى', 'الشريحة الثانية', 'الشريحة الثالثة'],
    progress: 'التقدم'
  }
} as const

export type KitLabels = (typeof LABELS)['en'] | (typeof LABELS)['ar']

/** A colour as a design JSX attribute value. */
const hex = (value: string) => JSON.stringify(value)

/** The variable a role's token names, by the first name the document has. */
function tokenVariable(graph: SceneGraph, names: readonly string[]): string | undefined {
  const byName = new Map<string, string>()
  for (const variable of graph.variables.values())
    if (variable.type === 'COLOR' && !byName.has(variable.name))
      byName.set(variable.name, variable.id)
  for (const name of names) {
    const id = byName.get(name)
    if (id) return id
  }
  return undefined
}

/** The kit's theme in a document: its tokens where it has them. */
export function kitTheme(graph: SceneGraph, options: KitOptions = {}): KitTheme {
  const rtl = options.rtl ?? false
  const locale = options.locale ?? (rtl ? 'ar' : 'en')
  const color = (role: keyof typeof FALLBACK) => {
    const id = tokenVariable(graph, TOKEN_NAMES[role])
    return id ? `{designVar(${JSON.stringify(id)})}` : hex(FALLBACK[role])
  }
  return {
    primary: color('primary'),
    onPrimary: color('onPrimary'),
    text: color('text'),
    muted: color('muted'),
    surface: color('surface'),
    subtle: color('subtle'),
    border: color('border'),
    danger: color('danger'),
    success: color('success'),
    rtl,
    // Lawha bundles Noto Naskh Arabic, so right-to-left labels draw everywhere.
    font: rtl ? 'Noto Naskh Arabic' : 'Inter',
    labels: LABELS[locale]
  }
}

/** A colour as JSX at an opacity, for tints and scrims; tokens keep their own colour. */
export function tint(value: string, opacity: number): string {
  const match = /^"#([0-9a-f]{6})"$/i.exec(value)
  if (!match) return value
  const alpha = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, '0')
  return hex(`#${match[1]}${alpha}`)
}

/** Text content safe inside JSX children. */
export function jsxText(text: string): string {
  return `{${JSON.stringify(text)}}`
}

/** A row's flow and a text's direction, as the theme reads. */
export function flow(theme: KitTheme): string {
  return theme.rtl ? 'flow="rtl"' : ''
}

export function textDir(theme: KitTheme): string {
  return theme.rtl ? 'dir="rtl" textAlign="right"' : ''
}
