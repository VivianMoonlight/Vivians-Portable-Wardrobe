import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Run the standalone design model without changing the production toolchain.
const source = await readFile(new URL('./model.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { outfits, initialAppearance, buildPreview, clothingSlots } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const candidate = outfits[0];
const before = JSON.stringify(initialAppearance);

const clothes = buildPreview(initialAppearance, candidate, 'clothing');
assert.equal(clothes.appearance.outer, initialAppearance.outer, 'Default clothing keeps an unsaved outer layer.');
assert.equal(clothes.appearance.hair, initialAppearance.hair);
assert.equal(clothes.appearance.body, initialAppearance.body);
assert.equal(clothes.changes.filter(c => c.changed).length, 3);

const entire = buildPreview(initialAppearance, candidate, 'all');
assert.equal(entire.appearance.outer, null, 'Entire appearance clears the absent outer layer.');
assert.equal(entire.appearance.hair, candidate.slots.hair);
assert.equal(entire.changes.find(c => c.slot === 'outer').action, 'clear');
assert.equal(entire.changes.filter(c => c.changed).length, 6);

const shoes = buildPreview(initialAppearance, candidate, 'custom', ['shoes']);
assert.deepEqual(shoes.changes.filter(c => c.changed).map(c => c.slot), ['shoes']);
assert.equal(shoes.appearance.outer, initialAppearance.outer);
assert.equal(shoes.appearance.top, initialAppearance.top);

const savedSlots = clothingSlots.filter(slot => candidate.slots[slot] !== null);
const withHair = buildPreview(initialAppearance, candidate, 'custom', [...savedSlots, 'hair']);
assert.equal(withHair.appearance.hair, candidate.slots.hair);
assert.equal(withHair.appearance.outer, initialAppearance.outer, 'Adding hair to clothing scope must not clear the outer layer.');

const noBody = { ...candidate, slots: { ...candidate.slots, body: null } };
assert.equal(buildPreview(initialAppearance, noBody, 'all').appearance.body, initialAppearance.body);
assert.equal(buildPreview(initialAppearance, noBody, 'custom', ['body']).appearance.body, initialAppearance.body);
assert.equal(buildPreview(clothes.appearance, candidate, 'clothing').changes.filter(c => c.changed).length, 0, 'Reapplying the same preview has no changes.');
assert.equal(buildPreview(initialAppearance, candidate, 'custom', []).changes.filter(c => c.changed).length, 0);
assert.equal(JSON.stringify(initialAppearance), before, 'Preview does not mutate the current appearance.');
console.log('Design model checks passed: clothing merge, full replacement, shoes only, custom toggling, required body, zero changes, immutability.');
