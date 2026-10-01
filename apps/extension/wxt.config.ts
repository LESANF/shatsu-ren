import { defineConfig } from 'wxt';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

// 백엔드 기본값: 빌드 환경변수(.env / .env.development). 없으면 "개발 빌드"로 표시하고 설정에서 개인 프로젝트를 연결한다.
const env = () => ({
  backendUrl: (import.meta.env.WXT_SUPABASE_URL ?? process.env.WXT_SUPABASE_URL ?? '') as string,
  anonKey: (import.meta.env.WXT_SUPABASE_ANON_KEY ??
    process.env.WXT_SUPABASE_ANON_KEY ??
    '') as string,
  devAuth: process.env.SHATSU_DEV_AUTH === '1',
});

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  outDir: '.output',
  manifest: ({ mode }) => {
    const { backendUrl } = env();
    return {
      name: 'shatsu-ren',
      short_name: 'shatsu-ren',
      description: 'Your bookmarks, across browsers.',
      default_locale: 'ko',
      permissions: ['bookmarks', 'storage', 'alarms', 'identity'],
      // 정확한 backend origin 만. 개인 프로젝트는 optional host permission 으로 사용자 클릭 시 요청.
      host_permissions: backendUrl ? [new URL(backendUrl).origin + '/*'] : [],
      optional_host_permissions: [
        'https://*/*',
        ...(mode === 'development' ? ['http://127.0.0.1/*'] : []),
      ],
      icons: {
        16: '/icons/icon-16.png',
        32: '/icons/icon-32.png',
        48: '/icons/icon-48.png',
        128: '/icons/icon-128.png',
      },
      action: { default_title: 'shatsu-ren' },
      content_security_policy: {
        extension_pages:
          "script-src 'self'; object-src 'self'; connect-src https: http://127.0.0.1:* ws://127.0.0.1:* wss:;",
      },
    };
  },
  vite: () => {
    const { backendUrl, anonKey, devAuth } = env();
    return {
      define: {
        __SHATSU_DEV_AUTH__: JSON.stringify(devAuth),
        __SHATSU_BACKEND_URL__: JSON.stringify(backendUrl),
        __SHATSU_BACKEND_KEY__: JSON.stringify(anonKey),
        __SHATSU_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
      },
    };
  },
  zip: { artifactTemplate: 'shatsu-ren-{{version}}-{{browser}}.zip' },
  hooks: {
    'zip:done': async (_wxt, files) => {
      for (const file of files)
        await writeFile(
          `${file}.sha256`,
          `${createHash('sha256')
            .update(await readFile(file))
            .digest('hex')}  ${basename(file)}\n`,
        );
    },
  },
});
