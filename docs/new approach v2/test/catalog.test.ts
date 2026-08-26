import {describe,it,expect} from 'vitest';import {describeFootprint,matchCatalog} from '../src/catalogMatcher.js';
const r=[{x:0,y:0},{x:2,y:0},{x:2,y:1},{x:0,y:1}];
describe('catalog footprint matcher',()=>{it('matches translated rotated scaled-equivalent footprint when dimensions agree',()=>{const fp=describeFootprint(r),proto={catalogId:'bed',assetUrl:'/items/single-bed/model.glb',category:'Beds',dimensions:[2,1,1] as const,footprint:fp};expect(matchCatalog(fp,[proto])?.prototype.catalogId).toBe('bed')})})
