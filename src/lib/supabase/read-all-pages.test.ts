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
