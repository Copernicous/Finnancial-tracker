/**
 * post-build.js
 * Runs after the EXE is compiled. Copies all files needed on the
 * production server into dist/ so it is a self-contained package.
 *
 * Files copied:
 *   .env                â€” environment config (required to run)
 *   CHANGELOG.md        â€” version history / what changed
 *   DEFERRED-ITEMS.txt  â€” security / tech-debt tracking
 *   OPERATIONS_MANUAL.md â€” admin and recovery procedures
 *   install-service.ps1 â€” Windows Service installer
 *   uninstall-service.ps1 â€” Windows Service remover
 */

'use strict';
const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const root    = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const packageInfo = require(path.join(root, 'package.json'));

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

const filesToCopy = [
    '.env',
    '.env.example',
    'CHANGELOG.md',
    'PRODUCTION_RELEASE_CHECKLIST.md',
    'DEFERRED-ITEMS.txt',
    'OPERATIONS_MANUAL.md',
    'install-service.ps1',
    'uninstall-service.ps1',
];

// Do not carry the retired all-process-killing manager into new artifacts.
fs.rmSync(path.join(distDir, 'Home-Accounting-Manager.bat'), { force: true });

let copied = 0;
let skipped = 0;

for (const file of filesToCopy) {
    const src = path.join(root, file);
    const dst = path.join(distDir, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
        console.log('âœ“ ' + file + '  â†’  dist/' + file);
        copied++;
    } else {
        console.log('âš  ' + file + '  (not found â€” skipped)');
        skipped++;
    }
}

const releaseNotesSource = path.join(root, '.github', 'releases', 'v' + packageInfo.version + '.md');
const releaseNotesTarget = 'RELEASE_NOTES-v' + packageInfo.version + '.md';
if (fs.existsSync(releaseNotesSource)) {
    fs.copyFileSync(releaseNotesSource, path.join(distDir, releaseNotesTarget));
    console.log('âœ“ ' + releaseNotesTarget + '  â†’  dist/' + releaseNotesTarget);
    copied++;
} else {
    console.log('âš  ' + releaseNotesTarget + '  (not found â€” skipped)');
    skipped++;
}

console.log('');
console.log('dist/ is ready: ' + copied + ' file(s) copied' + (skipped ? ', ' + skipped + ' skipped' : '') + '.');
const updateFiles = ['server.exe', ...filesToCopy, releaseNotesTarget]
    .map(file => path.join(distDir, file))
    .filter(file => fs.existsSync(file));

const updateZip = path.join(distDir, 'server-update-' + packageInfo.version + '.zip');
if (updateFiles.length > 0) {
    fs.rmSync(updateZip, { force: true });

    const expectedEntries = ['server.exe', ...filesToCopy, releaseNotesTarget]
        .filter(file => fs.existsSync(path.join(distDir, file)));
    const psArray = updateFiles
        .map(file => "'" + file.replace(/'/g, "''") + "'")
        .join(',');
    const psExpected = expectedEntries
        .map(file => "'" + file.replace(/'/g, "''") + "'")
        .join(',');
    const psDestination = updateZip.replace(/'/g, "''");
    const command = [
        "$ErrorActionPreference = 'Stop'",
        "$files = @(" + psArray + ")",
        "$expected = @(" + psExpected + ")",
        "$destination = '" + psDestination + "'",
        "Add-Type -AssemblyName System.IO.Compression.FileSystem",
        "for ($attempt = 1; $attempt -le 8; $attempt++) {",
        "  try {",
        "    if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }",
        "    Compress-Archive -LiteralPath $files -DestinationPath $destination -CompressionLevel Optimal -Force",
        "    $zip = [System.IO.Compression.ZipFile]::OpenRead($destination)",
        "    try { $names = @($zip.Entries | ForEach-Object { $_.FullName }) } finally { $zip.Dispose() }",
        "    foreach ($entry in $expected) { if ($names -notcontains $entry) { throw \"Zip missing $entry\" } }",
        "    break",
        "  } catch {",
        "    if ($attempt -ge 8) { throw }",
        "    Start-Sleep -Milliseconds (500 * $attempt)",
        "  }",
        "}"
    ].join('; ');

    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        stdio: 'inherit'
    });
    console.log('âœ“ server-update-' + packageInfo.version + '.zip  â†’  dist/server-update-' + packageInfo.version + '.zip');
}
console.log('Deploy the entire dist\\ folder to the production server.');

