import { i18n } from '#vue/i18n/create'

/**
 * Frame preset names the editor shows in the reader's language, by the preset's id in
 * camelCase. Device and product names, such as iPhone 17 or MacBook Air, stay as Figma writes
 * them and have no entry here.
 */
export const framePresetMessageDefaults = {
  androidCompact: 'Android Compact',
  androidMedium: 'Android Medium',
  androidExpanded: 'Android Expanded',
  androidSmall: 'Android Small',
  androidLarge: 'Android Large',
  desktop: 'Desktop',
  wireframe: 'Wireframe',
  slide169: 'Slide 16:9',
  slide43: 'Slide 4:3',
  letter: 'Letter',
  tabloid: 'Tabloid',
  businessCard90x50: 'Business card 90×50 mm',
  businessCard85x55: 'Business card 85×55 mm',
  flyerDl: 'DL flyer 99×210 mm',
  poster50x70: 'Poster 50×70 cm',
  rollup85x200: 'Roll-up 85×200 cm',
  envelopeDl: 'Envelope DL 220×110 mm',
  web1920: 'Web 1920',
  web1440: 'Web 1440',
  web1366: 'Web 1366',
  web1280: 'Web 1280',
  webTablet: 'Web tablet 768',
  webMobile: 'Web mobile 390',
  webMobileSmall: 'Web mobile 360',
  twitterPost: 'Twitter post',
  twitterHeader: 'Twitter header',
  facebookPost: 'Facebook post',
  facebookCover: 'Facebook cover',
  instagramPost: 'Instagram post',
  instagramStory: 'Instagram story',
  instagramSquare: 'Instagram square',
  dribbbleShot: 'Dribbble shot',
  dribbbleShotHd: 'Dribbble shot HD',
  linkedinCover: 'LinkedIn cover',
  linkedinPost: 'LinkedIn post',
  xPost: 'X post',
  tiktokVideo: 'TikTok video',
  snapchatStory: 'Snapchat story',
  whatsappStatus: 'WhatsApp status',
  youtubeThumbnail: 'YouTube thumbnail',
  youtubeBanner: 'YouTube banner',
  pinterestPin: 'Pinterest pin',
  pluginIcon: 'Plugin icon',
  profileBanner: 'Profile banner',
  pluginFileCover: 'Plugin / file cover'
} as const

export const framePresetMessages = i18n('framePresets', framePresetMessageDefaults)
