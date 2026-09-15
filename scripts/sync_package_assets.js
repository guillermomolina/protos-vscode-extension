"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const META = path.join(ROOT, "dist", "meta.json");
const SOURCE_LICENSE = path.join(ROOT, "LICENSE.TXT");
const PACKAGE_LICENSE = path.join(ROOT, "license.txt");
const NOTICES = path.join(ROOT, "THIRD_PARTY_NOTICES.txt");

function fail(message) {
    console.error(`LM009_I1B_PACKAGE_ASSETS_FAILED: ${message}`);
    process.exit(2);
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        fail(`${file}: ${error.message}`);
    }
}

function normalized(value) {
    return value.replaceAll("\\", "/");
}

function packageRootForInput(input) {
    const value = normalized(input);
    const marker = "node_modules/";
    const markerIndex = value.lastIndexOf(marker);
    if (markerIndex < 0) {
        return undefined;
    }

    const prefix = value.slice(0, markerIndex + marker.length);
    const rest = value.slice(markerIndex + marker.length);
    const parts = rest.split("/").filter(Boolean);
    if (parts.length === 0) {
        return undefined;
    }

    const packageParts = parts[0].startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1);
    if (packageParts.length === 0 || (parts[0].startsWith("@") && packageParts.length !== 2)) {
        fail(`cannot identify npm package root for bundle input: ${input}`);
    }

    return path.resolve(ROOT, prefix + packageParts.join("/"));
}

function licenseFiles(packageRoot) {
    let names;
    try {
        names = fs.readdirSync(packageRoot);
    } catch (error) {
        fail(`cannot list package root ${packageRoot}: ${error.message}`);
    }

    return names
        .filter((name) => /^(licen[cs]e|copying|notice)(\..*)?$/i.test(name))
        .sort((a, b) => a.localeCompare(b));
}

function expectedNoticeText(meta) {
    const packageRoots = new Set();

    for (const input of Object.keys(meta.inputs || {})) {
        const packageRoot = packageRootForInput(input);
        if (packageRoot) {
            packageRoots.add(packageRoot);
        }
    }

    if (packageRoots.size === 0) {
        fail("bundle metafile contains no third-party npm inputs");
    }

    const packages = [];
    for (const packageRoot of packageRoots) {
        const packageJson = readJson(path.join(packageRoot, "package.json"));
        const name = packageJson.name;
        const version = packageJson.version;
        if (typeof name !== "string" || typeof version !== "string") {
            fail(`package identity missing in ${packageRoot}`);
        }

        const license = typeof packageJson.license === "string"
            ? packageJson.license
            : JSON.stringify(packageJson.license ?? null);

        const files = licenseFiles(packageRoot);
        if (files.length === 0) {
            fail(`bundled package ${name}@${version} has no package-root license/notice file`);
        }

        packages.push({ name, version, license, packageRoot, files });
    }

    packages.sort((a, b) => {
        const byName = a.name.localeCompare(b.name);
        if (byName !== 0) {
            return byName;
        }
        return a.version.localeCompare(b.version);
    });

    const out = [];
    out.push("THIRD-PARTY NOTICES FOR THE PROTOS VS CODE EXTENSION");
    out.push("");
    out.push(
        "This file contains license and notice material for third-party npm packages " +
        "whose code is included in the production JavaScript bundle."
    );
    out.push(
        "It is generated deterministically from the exact installed packages and the " +
        "esbuild production metafile. Do not edit it by hand."
    );
    out.push("");

    for (const pkg of packages) {
        out.push(`=== ${pkg.name}@${pkg.version} ===`);
        out.push(`declared license: ${pkg.license}`);
        out.push("");

        for (const file of pkg.files) {
            const content = fs.readFileSync(path.join(pkg.packageRoot, file), "utf8")
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n")
                .split("\n")
                .map((line) => line.replace(/[ \t]+$/g, ""))
                .join("\n")
                .replace(/\n+$/g, "");
            out.push(`--- ${file} ---`);
            out.push(content);
            out.push("");
        }
    }

    return out.join("\n").replace(/\n+$/g, "") + "\n";
}

function checkOrWrite(file, expected, check) {
    if (check) {
        let actual;
        try {
            actual = fs.readFileSync(file);
        } catch (error) {
            fail(`${file} missing: ${error.message}`);
        }
        const expectedBuffer = Buffer.isBuffer(expected) ? expected : Buffer.from(expected, "utf8");
        if (!actual.equals(expectedBuffer)) {
            fail(`${file} is stale; regenerate package assets and commit the result`);
        }
        return;
    }

    fs.writeFileSync(file, expected);
}

function main() {
    const check = process.argv.includes("--check");
    if (!fs.existsSync(META)) {
        fail("dist/meta.json missing; run npm run build first");
    }
    if (!fs.existsSync(SOURCE_LICENSE)) {
        fail("repository LICENSE.TXT missing");
    }

    const meta = readJson(META);
    const sourceLicense = fs.readFileSync(SOURCE_LICENSE);
    const notices = expectedNoticeText(meta);

    checkOrWrite(PACKAGE_LICENSE, sourceLicense, check);
    checkOrWrite(NOTICES, notices, check);

    console.log(`LM009_I1B_PACKAGE_ASSETS: ${check ? "PASS" : "WRITTEN"}`);
    console.log("PACKAGE_LICENSE=license.txt");
    console.log("THIRD_PARTY_NOTICES=THIRD_PARTY_NOTICES.txt");
}

main();
