import { GuideNode, SlabNode, WallNode, WindowNode, DoorNode, ItemNode } from '../../../../../node_modules/@pascal-app/core/dist/schema/index.js';
let failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '-', (e as Error).message); }
}
check('guide', () => { const n = GuideNode.parse({ id:'guide_1', name:'Guide', url:'data:image/png;base64,AAA', scale:100, parentId:'lvl' }); if (n.id!=='guide_1'||n.type!=='guide') throw new Error('guide'); });
check('slab', () => { const n = SlabNode.parse({ id:'slab_1', name:'Slab', parentId:'lvl', polygon:[[0,0],[5,0],[5,5],[0,5]], thickness:0.2 }); if (n.id!=='slab_1'||n.type!=='slab') throw new Error('slab'); });
check('wall', () => { const n = WallNode.parse({ id:'wall_1', name:'Wall', parentId:'lvl', start:[0,0], end:[5,0], thickness:0.2, height:3 }); if (n.id!=='wall_1'||n.type!=='wall') throw new Error('wall'); });
check('window', () => { const n = WindowNode.parse({ id:'window_1', name:'Window', parentId:'wall_1', wallId:'wall_1', width:1, height:1.2, position:[2,1,0], rotation:[0,0,0] }); if (n.id!=='window_1'||n.type!=='window') throw new Error('window'); });
check('door', () => { const n = DoorNode.parse({ id:'door_1', name:'Door', parentId:'wall_1', wallId:'wall_1', width:0.9, height:2.1, position:[2,1,0], rotation:[0,0,0] }); if (n.id!=='door_1'||n.type!=='door') throw new Error('door'); });
check('item', () => { const n = ItemNode.parse({ id:'item_1', name:'Sofa', parentId:'lvl', position:[2,0,2], asset:{ id:'reception-sofa', category:'furniture', name:'Reception Sofa', thumbnail:'/items/reception-sofa/thumbnail.webp', src:'/items/reception-sofa/model.glb', dimensions:[2,0.8,0.9], attachTo:undefined, rotation:[0,0,0] } }); if (n.id!=='item_1'||n.type!=='item') throw new Error('item'); });
if (failed>0) { console.log('SCHEMA_CONTRACT_FAILED='+failed); process.exit(1); } else console.log('SCHEMA_CONTRACT_PASSED=6');
