import { params } from '@nanostores/i18n'

import { i18n } from '#vue/i18n/create'

export const pageMessageDefaults = {
  newPage: 'New page',
  rename: 'Rename',
  delete: 'Delete',
  pageName: params('Page {number}'),
  pages: 'Pages',
  goToPage: 'Go to page…',
  recentPage: 'Recent',
  currentPage: 'Current page',
  pageNameLabel: 'Page name',
  newMasterPage: 'New master page',
  applyMasterPage: params('Apply {name}'),
  removeMasterPage: 'Remove master page',
  insertPageNumber: 'Insert page number',
  linkTextFrames: 'Link text frames',
  unlinkTextFrame: 'Unlink text frame',
  publication: 'Publication',
  publicationPages: 'Pages',
  addPublicationPage: 'Add page',
  duplicatePublicationPage: 'Duplicate page',
  deletePublicationPage: 'Delete page',
  noMasterPage: 'No master',
  masterPages: 'Masters',
  detachFromMaster: 'Detach from master',
  convertToMasterPage: 'Convert to master page',
  pageNumberStart: 'Start at',
  pageNumberFormat: 'Numbers',
  numberFormatWestern: 'Western (1, 2, 3)',
  numberFormatArabicIndic: '١, ٢, ٣ (Arabic-Indic)',
  numberFormatRoman: 'Roman (i, ii, iii)',
  numberFormatRomanUpper: 'Roman capitals (I, II, III)',
  pageDirection: 'Page order',
  leftToRight: 'Left to right',
  rightToLeft: 'Right to left',
  facingPages: 'Facing pages',
  noPublicationPages: 'Frames placed on the canvas are the pages. Add one to start.'
} as const

export const pageMessages = i18n('pages', pageMessageDefaults)
