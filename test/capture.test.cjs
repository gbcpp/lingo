const test = require('node:test');
const assert = require('node:assert/strict');
const { rectangle, cropPlan } = require('../src/capture-geometry.cjs');
const displays = [
    { id: 'left', bounds: { x: -100, y: 0, width: 100, height: 100 }, size: { width: 100, height: 100 } },
    { id: 'right', bounds: { x: 0, y: 0, width: 100, height: 100 }, size: { width: 200, height: 200 } },
];
test('Crops across negative origins and different screen densities without seams', () => {
    const plan = cropPlan(rectangle({ x: 50, y: 60 }, { x: -50, y: 10 }), displays);
    assert.equal(plan.width, 200);
    assert.equal(plan.height, 100);
    assert.deepEqual(plan.tiles[0].source, { x: 50, y: 10, width: 50, height: 50 });
    assert.deepEqual(plan.tiles[1].source, { x: 0, y: 20, width: 100, height: 100 });
    assert.deepEqual(plan.tiles.map(t => t.target), [{ x: 0, y: 0, width: 100, height: 100 }, { x: 100, y: 0, width: 100, height: 100 }]);
});
test('Selects the second display alone and clamps the crop to its bounds', () => {
    const plan = cropPlan({ x: 20, y: 20, width: 200, height: 200 }, displays);
    assert.equal(plan.tiles.length, 1);
    assert.equal(plan.tiles[0].id, 'right');
    assert.equal(plan.width, 160);
    assert.equal(plan.height, 160);
});
test('Preserves gaps and vertical offsets between displays', () => {
    const plan = cropPlan({ x: -100, y: -100, width: 200, height: 300 }, [displays[0], { ...displays[1], bounds: { x: 0, y: -100, width: 100, height: 80 } }]);
    assert.equal(plan.tiles[0].target.y, 250);
    assert.equal(plan.tiles[1].target.y, 0);
    assert.equal(plan.height, 500);
});
test('Rejects empty selections and bounds large composite allocations', () => {
    assert.throws(() => cropPlan({ x: 1000, y: 1000, width: 50, height: 50 }, displays));
    assert.throws(() => cropPlan({ x: 0, y: 0, width: 1, height: 1 }, displays));
    const plan = cropPlan({ x: 0, y: 0, width: 20000, height: 10000 }, [
        { id: 1, bounds: { x: 0, y: 0, width: 20000, height: 10000 }, size: { width: 40000, height: 20000 } },
    ]);
    assert.ok(plan.width * plan.height <= 32000000);
    assert.ok(plan.width <= 16000);
});
