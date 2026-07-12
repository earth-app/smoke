import tailwindcss from '@tailwindcss/vite';
import { defineNuxtConfig } from 'nuxt/config';

// e2e coverage builds run under node (preview server + source-mapped coverage), not workerd
const E2E_BUILD = process.env.NUXT_PUBLIC_E2E === '1';

export default defineNuxtConfig({
	site: {
		url: process.env.NUXT_PUBLIC_SITE_URL || 'https://smoke.pages.dev',
		name: process.env.NUXT_PUBLIC_SITE_NAME || 'Smoke'
	},
	schemaOrg: {
		identity: {
			type: 'Organization',
			name: process.env.NUXT_PUBLIC_SITE_NAME || 'Smoke',
			logo: '/favicon.png'
		}
	},
	robots: {
		// token status pages + staff/setup/api surfaces stay out of the index
		disallow: ['/dashboard', '/setup', '/login', '/status', '/api']
	},
	sitemap: {
		exclude: ['/dashboard/**', '/setup', '/login', '/status/**']
	},
	runtimeConfig: {
		// mock the cloudflare api in non-prod e2e so provisioning flows are testable offline
		mockCf: process.env.MOCK_CF === '1',
		public: {
			site_url: process.env.NUXT_PUBLIC_SITE_URL,
			// gates the hydration marker used by playwright waitForHydration
			e2e: process.env.NUXT_PUBLIC_E2E === '1',
			// favicon/theme fallbacks; the favicon.* routes resolve kv settings then fall back to these
			themeColor: process.env.NUXT_PUBLIC_THEME_COLOR || '#3b82f6',
			favicon: process.env.NUXT_PUBLIC_FAVICON || '/_favicon.ico',
			faviconPng: process.env.NUXT_PUBLIC_FAVICON_PNG || '/_favicon.png'
		},
		turnstile: {
			secretKey: process.env.NUXT_TURNSTILE_SECRET_KEY || ''
		}
	},
	ssr: true,
	// the coverage build needs client+server sourcemaps so monocart can unpack _nuxt/*.js back to
	// src/* (codecov matches coverage by repo-relative source path, not by dist url)
	...(E2E_BUILD ? { sourcemap: { client: true, server: true } } : {}),
	compatibilityDate: '2025-12-13',
	devtools: { enabled: process.env.NODE_ENV === 'development' },
	srcDir: 'src',
	serverDir: 'src/server',
	dir: {
		shared: 'src/shared'
	},
	css: ['~/assets/css/main.css'],
	vite: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		plugins: [tailwindcss() as any],
		css: {
			devSourcemap: true,
			transformer: 'lightningcss'
		},
		build: {
			cssMinify: 'lightningcss'
		},
		optimizeDeps: {
			include: [
				'prosemirror-state',
				'prosemirror-view',
				'prosemirror-model',
				'prosemirror-transform',
				'@tiptap/core',
				'@tiptap/extension-emoji',
				'@tiptap/extension-text-align',
				'marked',
				'highlight.js'
			]
		}
	},
	hub: {
		dir: process.env.NUXT_HUB_DIR || '.data',
		blob: true,
		cache: true,
		kv: process.env.NUXT_HUB_DIR
			? { driver: 'fs-lite', base: `${process.env.NUXT_HUB_DIR}/kv` }
			: true,
		db: 'sqlite'
	},
	$production: {
		nitro: {
			// e2e build serves via a node preview; the real deploy build stays cloudflare_module
			preset: E2E_BUILD ? 'node-server' : 'cloudflare_module',
			cloudflare: {
				deployConfig: true,
				nodeCompat: true
			}
		}
	},
	nitro: {
		// nitro tasks power the scheduled inbound-mail poll (off unless a mailbox is configured)
		experimental: {
			tasks: true
		},
		scheduledTasks: {
			'*/15 * * * *': ['email:poll'],
			// daily retention sweep: auto-archive aged closed tickets, purge if delete is enabled
			'0 3 * * *': ['retention:cleanup'],
			// daily audit-log prune per the configured retention window (no-op when unset)
			'30 3 * * *': ['audit:cleanup']
		},
		prerender: {
			ignore: ['/api/**']
		},
		routeRules: {
			'/api/**': { prerender: false, cors: true },
			'/favicon.png': { headers: { 'Cache-Control': 'public, max-age=31536000' } },
			'/favicon.ico': { headers: { 'Cache-Control': 'public, max-age=31536000' } },
			'/favicon.svg': { headers: { 'Cache-Control': 'public, max-age=31536000' } }
		}
	},
	modules: [
		'@nuxthub/core',
		'@nuxtjs/i18n',
		'@nuxt/ui',
		'nuxt-viewport',
		'@nuxtjs/robots',
		'@nuxtjs/sitemap',
		'nuxt-schema-org',
		'nuxt-api-shield',
		'@nuxtjs/turnstile',
		'@nuxt/image',
		'@pinia/nuxt',
		'@nuxt/hints',
		[
			'@nuxtjs/google-fonts',
			{
				families: {
					'Noto+Sans': true
				},
				display: 'swap',
				preload: true,
				prefetch: true,
				preconnect: true
			}
		],
		[
			'@nuxt/icon',
			{
				icon: {
					mode: 'css',
					cssLayer: 'base',
					size: '48px'
				}
			}
		],
		[
			'@codecov/nuxt-plugin',
			{
				enableBundleAnalysis: process.env.CODECOV_TOKEN !== undefined,
				bundleName: 'smoke',
				uploadToken: process.env.CODECOV_TOKEN
			}
		]
	],
	image: {
		quality: 85,
		format: ['webp', 'avif'],
		screens: {
			xs: 320,
			sm: 640,
			md: 768,
			lg: 1024,
			xl: 1280,
			xxl: 1536
		},
		presets: {
			thumbnail: {
				modifiers: {
					format: 'webp',
					quality: 85,
					fit: 'cover'
				}
			}
		}
	},
	hints: {
		features: {
			lazyLoad: false
		}
	},
	nuxtApiShield: {
		limit: {
			// scale the limiter way up outside production so dev/e2e never trip it
			max:
				process.env.NODE_ENV === 'production' && process.env.NUXT_PUBLIC_E2E !== '1' ? 500 : 100000,
			duration: 60,
			ban: 300
		},
		delayOnBan: true,
		errorMessage: 'Too many requests from this IP, please try again later.'
	},
	i18n: {
		locales: [{ code: 'en', language: 'en-US' }],
		defaultLocale: 'en'
	},
	turnstile: {
		siteKey: process.env.NUXT_PUBLIC_TURNSTILE_SITE_KEY || '',
		addValidateEndpoint: true
	},
	routeRules: {
		'/_ipx/**': {
			headers: {
				'Cache-Control': 'public, max-age=31536000, immutable'
			}
		}
	},
	experimental: {
		renderJsonPayloads: true,
		viewTransition: true
	}
});
