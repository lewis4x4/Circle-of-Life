import { expect, it } from 'vitest';
import { isTextureModifiedFoodForSolidOralHint } from './med-fluid-diet-hints';
it('retains solid-dose advisory for canonical numeric texture levels', () => {
 expect(isTextureModifiedFoodForSolidOralHint(4)).toBe(true);
 expect(isTextureModifiedFoodForSolidOralHint(7)).toBe(false);
 expect(isTextureModifiedFoodForSolidOralHint('level_4_pureed')).toBe(true);
});
