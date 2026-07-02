import { Plugin } from 'vite';
import { resolve, basename, extname } from 'path';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { build } from 'esbuild';

export default function scriptsCompilerPlugin(): Plugin {
  const srcDir = resolve(__dirname, '../src/scripts');
  const destDir = resolve(__dirname, '../dist/scripts');

  const compileAll = async () => {
    if (!existsSync(srcDir)) {
      mkdirSync(srcDir, { recursive: true });
    }
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    try {
      const files = readdirSync(srcDir).filter(file => file.endsWith('.ts') || file.endsWith('.js'));
      const scriptEntries = [];

      for (const file of files) {
        const filePath = resolve(srcDir, file);
        const nameWithoutExt = basename(file, extname(file));
        const outPath = resolve(destDir, `${nameWithoutExt}.js`);

        // Read metadata (JSDoc-style)
        const content = readFileSync(filePath, 'utf-8');
        const nameMatch = content.match(/@name\s+(.+)/);
        const descMatch = content.match(/@description\s+(.+)/);

        const displayName = nameMatch ? nameMatch[1].trim() : nameWithoutExt;
        const description = descMatch ? descMatch[1].trim() : `Auto-generated from ${file}`;

        // Compile TS/JS using esbuild to IIFE format
        await build({
          entryPoints: [filePath],
          outfile: outPath,
          bundle: true,
          minify: false,
          format: 'iife',
          target: 'es2020',
          logLevel: 'silent'
        });

        scriptEntries.push({
          id: nameWithoutExt,
          name: `${nameWithoutExt}.js`,
          path: `scripts/${nameWithoutExt}.js`,
          description: description,
          displayName: displayName
        });
      }

      // Write index.json
      writeFileSync(resolve(destDir, 'index.json'), JSON.stringify(scriptEntries, null, 2));
      console.log(`[user-scripts] Compiled ${files.length} scripts successfully to dist/scripts.`);
    } catch (err) {
      console.error('[user-scripts] Failed to compile user scripts:', err);
    }
  };

  return {
    name: 'user-scripts-compiler',
    async buildStart() {
      await compileAll();
    },
    async closeBundle() {
      await compileAll();
    },
    configureServer(server) {
      // Watch src/scripts for dev hot-reloads
      server.watcher.add(srcDir);
      server.watcher.on('all', async (event, path) => {
        if (path.startsWith(srcDir)) {
          console.log(`[user-scripts] File ${event}: ${basename(path)}, compiling...`);
          await compileAll();
        }
      });

      // Serve compiled scripts from dist/scripts/ during dev mode
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/scripts/')) {
          const cleanUrl = req.url.split('?')[0];
          const fileName = cleanUrl.replace('/scripts/', '');
          const filePath = resolve(destDir, fileName);

          if (existsSync(filePath)) {
            const mimeTypes: Record<string, string> = {
              '.js': 'application/javascript',
              '.json': 'application/json',
            };
            const ext = extname(filePath);
            res.setHeader('Content-Type', mimeTypes[ext] || 'text/plain');
            res.end(readFileSync(filePath));
            return;
          }
        }
        next();
      });
    }
  };
}
