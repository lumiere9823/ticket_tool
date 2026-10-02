import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage', 'scratch']);
const markdownFiles: string[] = [];

function collectMarkdownFiles(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectMarkdownFiles(absolutePath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      markdownFiles.push(absolutePath);
    }
  }
}

function isExternalReference(reference: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|#)/i.test(reference);
}

function resolveReference(sourceFile: string, reference: string): string {
  const withoutFragment = reference.split('#', 1)[0] ?? reference;
  const decoded = decodeURIComponent(withoutFragment);
  if (decoded.startsWith('/')) return path.resolve(repoRoot, `.${decoded}`);
  return path.resolve(path.dirname(sourceFile), decoded);
}

function reportMissing(sourceFile: string, reference: string, kind: string): void {
  const displayPath = path.relative(repoRoot, sourceFile).replaceAll('\\', '/');
  console.error(`${displayPath}: missing ${kind} reference: ${reference}`);
}

collectMarkdownFiles(repoRoot);
let failures = 0;

for (const sourceFile of markdownFiles) {
  const content = fs.readFileSync(sourceFile, 'utf8');

  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const reference = match[1]?.trim();
    if (!reference || isExternalReference(reference)) continue;
    if (!fs.existsSync(resolveReference(sourceFile, reference))) {
      reportMissing(sourceFile, reference, 'Markdown link');
      failures += 1;
    }
  }

  for (const match of content.matchAll(/`([^`]+)`/g)) {
    const reference = match[1]?.trim();
    if (!reference || isExternalReference(reference)) continue;
    if (
      !/^(?:docs|src|tests|scripts|public|\.agents|package\.json|tsconfig\.json|vite\.config\.ts|README\.md|HUONG_DAN_SU_DUNG\.md|AGENTS\.md|AI_ENGINEERING_RULES\.md)(?:[\\/]|$)/.test(
        reference
      )
    ) {
      continue;
    }
    if (!fs.existsSync(path.resolve(repoRoot, reference.replaceAll('/', path.sep)))) {
      reportMissing(sourceFile, reference, 'repository path');
      failures += 1;
    }
  }
}

if (failures > 0) {
  console.error(`Documentation check failed with ${failures} missing reference(s).`);
  process.exitCode = 1;
} else {
  console.info(`Documentation check passed (${markdownFiles.length} Markdown files scanned).`);
}
