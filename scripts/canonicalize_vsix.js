#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const yauzl = require("yauzl");
const yazl = require("yazl");

function fail(message) {
  console.error("LM009_I1C_CANONICALIZATION_FAILED: " + message);
  process.exit(2);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

if (process.argv.length !== 5) {
  fail("usage: canonicalize_vsix.js <input.vsix> <output.vsix> <source_date_epoch>");
}

const input = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const epoch = Number(process.argv[4]);

if (!Number.isInteger(epoch) || epoch < 0) fail("source_date_epoch must be a non-negative integer");

function safeName(name) {
  const normalized = name.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || normalized.split("/").some((part) => part === "..")) {
    fail("unsafe ZIP member path: " + name);
  }
  return normalized;
}

function openZip(filename) {
  return new Promise((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true, autoClose: true }, (error, zipfile) => (error ? reject(error) : resolve(zipfile)));
  });
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function readEntries(filename) {
  const zipfile = await openZip(filename);
  const entries = [];
  const seen = new Set();

  return new Promise((resolve, reject) => {
    let settled = false;
    const failOnce = (error) => {
      if (!settled) {
        settled = true;
        try { zipfile.close(); } catch (_) {}
        reject(error);
      }
    };
    zipfile.on("error", failOnce);
    zipfile.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(entries);
      }
    });
    zipfile.on("entry", (entry) => {
      if (settled) return;
      let name;
      try { name = safeName(entry.fileName); } catch (error) { failOnce(error); return; }
      if (seen.has(name)) { failOnce(new Error("duplicate ZIP member: " + name)); return; }
      seen.add(name);
      zipfile.openReadStream(entry, async (error, stream) => {
        if (error) { failOnce(error); return; }
        try {
          entries.push({ name, data: await readAll(stream), isDirectory: name.endsWith("/") });
          zipfile.readEntry();
        } catch (readError) { failOnce(readError); }
      });
    });
    zipfile.readEntry();
  });
}

function zipTimestamp(epochSeconds) {
  const minimumEpoch = Date.UTC(1980, 0, 1) / 1000;
  return new Date(Math.max(epochSeconds, minimumEpoch) * 1000);
}

function writeCanonical(filename, entries, mtime) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const outputStream = fs.createWriteStream(filename);
    const ordered = entries.slice().sort((left, right) => Buffer.compare(Buffer.from(left.name, "utf8"), Buffer.from(right.name, "utf8")));
    for (const entry of ordered) {
      if (entry.isDirectory) {
        zip.addEmptyDirectory(entry.name, { mtime, mode: 0o40755 });
      } else {
        zip.addBuffer(entry.data, entry.name, { mtime, mode: 0o100644, compress: false });
      }
    }
    outputStream.on("error", reject);
    outputStream.on("close", resolve);
    zip.outputStream.pipe(outputStream);
    zip.end();
  });
}

(async () => {
  if (!fs.existsSync(input)) fail("input VSIX does not exist: " + input);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const entries = await readEntries(input);
  if (entries.length === 0) fail("input VSIX contains no ZIP members");
  await writeCanonical(output, entries, zipTimestamp(epoch));
  console.log("LM009_I1C_CANONICALIZATION=PASS");
  console.log("VSIX_CANONICAL_TIMESTAMP_SOURCE=SOURCE_DATE_EPOCH_FROM_GIT_COMMIT");
  console.log("VSIX_CANONICAL_COMPRESSION=STORE");
  console.log("VSIX_CANONICAL_ORDER=LEXICOGRAPHIC");
  console.log("VSIX_CANONICAL_MODE=FIXED");
  console.log("VSIX_SEMANTIC_MEMBER_BYTES_CHANGED=NO");
  console.log("VSIX_ARTIFACT_SHA256=" + sha256(fs.readFileSync(output)));
})().catch((error) => fail(error && error.message ? error.message : String(error)));
