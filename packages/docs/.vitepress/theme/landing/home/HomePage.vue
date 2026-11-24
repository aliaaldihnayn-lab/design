<script setup lang="ts">
import { withBase } from 'vitepress'
import { computed, nextTick, onBeforeUnmount, onMounted } from 'vue'

import {
  ar,
  en,
  RELEASE_URL,
  SOURCE_URL,
  WEB_APP_URL,
  type HomeLocale,
  type HomeShot
} from './content'

import './home.css'

/** `ar` at `/`, `en` at `/en`: each page imports this component with its language. */
const { locale } = defineProps<{ locale: HomeLocale }>()

const messages = computed(() => (locale === 'ar' ? ar : en))
const otherHome = computed(() => withBase(locale === 'ar' ? '/en' : '/'))
const docsLink = withBase('/getting-started')
const downloadLink = withBase('/download')

function shot(name: HomeShot, width: 640 | 1280): string {
  return withBase(`/home/${name}-${locale}-${width}.webp`)
}

function srcset(name: HomeShot): string {
  return `${shot(name, 640)} 640w, ${shot(name, 1280)} 1280w`
}

// The docs site's root locale is English; this page states its own language and direction on
// <html> while it is shown, so the browser, its spellcheck and screen readers follow it. The
// built HTML already says so (`transformHtml` in the config); VitePress's app sets the site's
// language once it mounts, after this component, so this waits for that.
onMounted(async () => {
  await nextTick()
  document.documentElement.lang = locale
  document.documentElement.dir = messages.value.dir
})
// Other pages are in the root locale, whose language VitePress does not set again on its own.
onBeforeUnmount(() => {
  document.documentElement.lang = 'en'
  document.documentElement.dir = 'ltr'
})
</script>

<template>
  <div class="home" :lang="locale" :dir="messages.dir" :data-locale="locale">
    <a class="home-skip" href="#home-main">{{ messages.skip }}</a>
    <header class="home-header">
      <div class="home-bar">
        <a class="home-brand" :href="withBase(locale === 'ar' ? '/' : '/en')">
          <img :src="withBase('/brand/app-icon.svg')" alt="" width="32" height="32" />
          <span>{{ locale === 'ar' ? 'لوحة' : 'Lawha' }}</span>
        </a>
        <nav class="home-nav" :aria-label="messages.nav.menu">
          <a href="#features">{{ messages.nav.features }}</a>
          <a href="#platforms">{{ messages.nav.platforms }}</a>
          <a :href="docsLink">{{ messages.nav.docs }}</a>
          <a :href="SOURCE_URL" rel="noopener">{{ messages.nav.source }}</a>
        </nav>
        <a
          class="home-switch"
          :href="otherHome"
          :hreflang="locale === 'ar' ? 'en' : 'ar'"
          :lang="locale === 'ar' ? 'en' : 'ar'"
          :aria-label="messages.switchTo"
        >
          {{ messages.switchLabel }}
        </a>
      </div>
    </header>

    <main id="home-main">
      <section class="home-hero" aria-labelledby="home-title">
        <div class="home-hero-copy">
          <img
            class="home-hero-mark"
            :src="withBase('/brand/mark.svg')"
            alt=""
            width="96"
            height="96"
          />
          <h1 id="home-title">{{ messages.hero.title }}</h1>
          <p class="home-lead">{{ messages.hero.lead }}</p>
          <div class="home-actions">
            <a class="home-button home-button-solid" :href="RELEASE_URL" rel="noopener">
              {{ messages.hero.download }}
            </a>
            <a class="home-button home-button-outline" :href="WEB_APP_URL" rel="noopener">
              {{ messages.hero.web }}
            </a>
          </div>
          <p class="home-note">{{ messages.hero.note }}</p>
        </div>
        <figure class="home-window">
          <img
            :src="shot('canvas', 1280)"
            :srcset="srcset('canvas')"
            sizes="(min-width: 1200px) 1100px, 94vw"
            width="1280"
            height="800"
            fetchpriority="high"
            :alt="messages.hero.alt"
          />
        </figure>
      </section>

      <section id="features" class="home-features" aria-labelledby="home-features-title">
        <h2 id="home-features-title" class="home-section-title">{{ messages.featuresTitle }}</h2>
        <article
          v-for="feature in messages.features"
          :id="feature.id"
          :key="feature.id"
          class="home-feature"
          :data-wide="feature.shot === 'canvas' || undefined"
          :aria-labelledby="`${feature.id}-title`"
        >
          <div class="home-feature-copy">
            <p class="home-eyebrow">{{ feature.eyebrow }}</p>
            <h3 :id="`${feature.id}-title`">{{ feature.title }}</h3>
            <p>{{ feature.body }}</p>
            <ul>
              <li v-for="point in feature.points" :key="point">{{ point }}</li>
            </ul>
          </div>
          <!-- The canvas is the hero's screenshot; its section only adds the words. -->
          <figure v-if="feature.shot !== 'canvas'" class="home-window">
            <img
              :src="shot(feature.shot, 1280)"
              :srcset="srcset(feature.shot)"
              sizes="(min-width: 960px) 620px, 94vw"
              width="1280"
              height="800"
              loading="lazy"
              decoding="async"
              :alt="feature.alt"
            />
          </figure>
        </article>
      </section>

      <section id="platforms" class="home-platforms" aria-labelledby="home-platforms-title">
        <div class="home-platforms-copy">
          <h2 id="home-platforms-title" class="home-section-title">
            {{ messages.platforms.title }}
          </h2>
          <p class="home-lead">{{ messages.platforms.lead }}</p>
          <ul class="home-platform-list">
            <li v-for="platform in messages.platforms.items" :key="platform.name">
              <strong>{{ platform.name }}</strong>
              <span>{{ platform.detail }}</span>
            </li>
          </ul>
          <div class="home-actions">
            <a class="home-button home-button-solid" :href="RELEASE_URL" rel="noopener">
              {{ messages.platforms.download }}
            </a>
            <a class="home-button home-button-outline" :href="WEB_APP_URL" rel="noopener">
              {{ messages.platforms.web }}
            </a>
          </div>
          <p class="home-note">{{ messages.platforms.note }}</p>
        </div>
        <figure class="home-phone">
          <img
            :src="withBase(`/home/mobile-${locale}.webp`)"
            width="390"
            height="844"
            loading="lazy"
            decoding="async"
            :alt="messages.platforms.mobileAlt"
          />
        </figure>
      </section>
    </main>

    <footer class="home-footer">
      <img :src="withBase('/brand/mark-dark.svg')" alt="" width="40" height="40" />
      <p>{{ messages.footer.tagline }}</p>
      <nav :aria-label="messages.nav.menu">
        <a :href="docsLink">{{ messages.footer.docs }}</a>
        <a :href="downloadLink">{{ messages.footer.download }}</a>
        <a :href="SOURCE_URL" rel="noopener">{{ messages.footer.source }}</a>
        <a :href="otherHome" :lang="locale === 'ar' ? 'en' : 'ar'">{{ messages.switchLabel }}</a>
      </nav>
    </footer>
  </div>
</template>
