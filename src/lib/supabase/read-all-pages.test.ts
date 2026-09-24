import { expect, it } from 'vitest';
import { readAllPages } from './read-all-pages';
it('reads through a server row cap smaller than its page size and includes quiet tail records', async () => {
 const all = Array.from({length:1007},(_,id)=>({id}));
 const result = await readAllPages(async (from,to) => ({data:all.slice(from,Math.min(to+1,from+137)),count:all.length,error:null}));
 expect(result.data).toEqual(all);
});
it('rejects an incomplete response instead of silently exporting a partial list', async () => {
 await expect(readAllPages(async()=>({data:[],count:5,error:null}))).rejects.toThrow(/incomplete/i);
});
it('reads the pages after the first at once, in order, once the total is known (COL-674)', async () => {
 const all = Array.from({length:1600},(_,id)=>({id}));
 let inFlight = 0; let peak = 0;
 const result = await readAllPages(async (from,to) => {
  inFlight += 1; peak = Math.max(peak, inFlight);
  await new Promise((resolve) => setTimeout(resolve, 5));
  inFlight -= 1;
  return {data:all.slice(from,to+1),count:all.length,error:null};
 });
 expect(result.data).toEqual(all);
 expect(peak).toBe(3);
});
it('still refuses a total that changes between concurrent pages', async () => {
 let calls = 0;
 await expect(readAllPages(async (from,to) => ({data:Array.from({length:to-from+1},(_,i)=>({id:from+i})),count:(calls++ === 2 ? 1501 : 1500),error:null}))).rejects.toThrow(/changed/i);
});
