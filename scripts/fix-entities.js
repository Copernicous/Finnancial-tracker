/**
 * fix-entities.js
 * Replaces non-ASCII special characters with HTML entities in EJS views,
 * but ONLY in HTML content — skips <script>...</script> blocks so JS
 * template literals and property accessors are not broken.
 *
 * Run: node scripts/fix-entities.js
 */
const fs   = require('fs');
const path = require('path');

const VIEWS = path.join(__dirname, '..', 'views');

// Characters to replace in HTML content only
const REPLACEMENTS = [
    ['\u2014', '&mdash;'],    // — em dash
    ['\u2013', '&ndash;'],    // – en dash
    ['\u201C', '&ldquo;'],    // " left double quote
    ['\u201D', '&rdquo;'],    // " right double quote
    ['\u2018', '&lsquo;'],    // ' left single quote
    ['\u2019', '&rsquo;'],    // ' right single quote / apostrophe
    ['\u2026', '&hellip;'],   // … ellipsis
    ['\u00A9', '&copy;'],     // © copyright
    ['\u2192', '&rarr;'],     // → right arrow
    ['\u2190', '&larr;'],     // ← left arrow
    ['\u2022', '&bull;'],     // • bullet
    ['\u2713', '&#10003;'],   // ✓ check mark
    ['\u26A0', '&#9888;'],    // ⚠ warning sign
    ['\u2122', '&trade;'],    // ™ trademark
    ['\u2460', '&#9312;'],    // ① circled 1
    ['\u2461', '&#9313;'],    // ② circled 2
    ['\u2462', '&#9314;'],    // ③ circled 3
    ['\u2463', '&#9315;'],    // ④ circled 4
    ['\u00B7', '&middot;'],   // · middle dot
    ['\u00A0', '&nbsp;'],     // non-breaking space
];

/**
 * Split content into alternating [html, script, html, script, ...] segments.
 * Apply entity replacement only to HTML segments, leave script segments alone.
 */
function replaceEntitiesSkippingScripts(content) {
    // Split on <script...> and </script> boundaries
    const parts = content.split(/(<script[\s\S]*?<\/script>)/gi);
    return parts.map((part, i) => {
        // Odd-indexed parts are <script> blocks — leave them untouched
        if (i % 2 === 1) return part;
        // Even-indexed parts are HTML — apply replacements
        let html = part;
        for (const [char, entity] of REPLACEMENTS) {
            html = html.split(char).join(entity);
        }
        return html;
    }).join('');
}

let totalChanged = 0;

fs.readdirSync(VIEWS)
    .filter(f => f.endsWith('.ejs'))
    .forEach(filename => {
        const filePath = path.join(VIEWS, filename);
        const original = fs.readFileSync(filePath, 'utf8');
        const updated  = replaceEntitiesSkippingScripts(original);

        if (updated !== original) {
            fs.writeFileSync(filePath, updated, 'utf8');
            let count = 0;
            for (const [char] of REPLACEMENTS) count += (original.split(char).length - 1);
            console.log(`✓  ${filename}  (${count} chars → entities)`);
            totalChanged++;
        } else {
            console.log(`-  ${filename}  (no changes)`);
        }
    });

console.log(`\nDone. ${totalChanged} files updated.`);
