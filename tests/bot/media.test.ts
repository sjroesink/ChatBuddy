import { describe, it, expect } from 'vitest';
import { splitMessage, classifyDocument } from '../../src/bot/media.js';

describe('splitMessage', () => {
  it('returns short messages unchanged', () => {
    const text = 'Hello, world!';
    const result = splitMessage(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  it('returns messages exactly at limit unchanged', () => {
    const text = 'a'.repeat(4096);
    const result = splitMessage(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  it('splits long text at newline boundaries', () => {
    // Create text with clear newline split points
    const line = 'x'.repeat(2000);
    const text = `${line}\n${line}\n${line}`;
    const result = splitMessage(text);
    expect(result.length).toBeGreaterThan(1);
    // Each part should be <= 4096
    for (const part of result) {
      expect(part.length).toBeLessThanOrEqual(4096);
    }
    // Reassembling (joining with newline) should give original text
    expect(result.join('\n')).toBe(text);
  });

  it('does not split inside code blocks (even number of ``` per part)', () => {
    // Build a message: preamble + code block + more text, total > 4096
    const preamble = 'p'.repeat(1000) + '\n';
    const codeBlock = '```\n' + 'c'.repeat(2500) + '\n```\n';
    const suffix = 's'.repeat(1500) + '\n';
    const text = preamble + codeBlock + suffix;

    const result = splitMessage(text);
    expect(result.length).toBeGreaterThan(1);
    for (const part of result) {
      // Count occurrences of ``` in each part — should be even (0, 2, 4, ...)
      const fences = (part.match(/```/g) || []).length;
      expect(fences % 2).toBe(0);
    }
  });

  it('handles text with no good split points (hard split at 4096)', () => {
    const text = 'a'.repeat(5000); // no newlines at all
    const result = splitMessage(text);
    expect(result.length).toBeGreaterThan(1);
    for (const part of result) {
      expect(part.length).toBeLessThanOrEqual(4096);
    }
    expect(result.join('')).toBe(text);
  });
});

describe('classifyDocument', () => {
  it('classifies PDF files', () => {
    expect(classifyDocument('report.pdf')).toBe('pdf');
    expect(classifyDocument('REPORT.PDF')).toBe('pdf');
    expect(classifyDocument('path/to/doc.pdf')).toBe('pdf');
  });

  it('classifies common text file extensions', () => {
    const textFiles = [
      'readme.txt', 'data.csv', 'config.json', 'notes.md',
      'sitemap.xml', 'config.yaml', 'config.yml', 'Cargo.toml',
      'settings.ini', 'app.cfg', 'error.log', 'index.html',
      'styles.css', 'app.js', 'types.ts', 'script.py',
      'server.rb', 'main.go', 'lib.rs', 'Main.java',
      'utils.c', 'engine.cpp', 'header.h', 'header.hpp',
      'run.sh', 'build.bash', 'query.sql', '.env',
    ];
    for (const filename of textFiles) {
      expect(classifyDocument(filename)).toBe('text');
    }
  });

  it('classifies .gitignore as text', () => {
    // .gitignore has extension ".gitignore"
    expect(classifyDocument('.gitignore')).toBe('text');
  });

  it('classifies unsupported types', () => {
    expect(classifyDocument('photo.jpg')).toBe('unsupported');
    expect(classifyDocument('video.mp4')).toBe('unsupported');
    expect(classifyDocument('archive.zip')).toBe('unsupported');
    expect(classifyDocument('binary.exe')).toBe('unsupported');
    expect(classifyDocument('noextension')).toBe('unsupported');
  });
});
