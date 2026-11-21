import type {BbPluginApi} from '@get-bb/plugin-sdk';
import type {Board} from './board';

/** Follow the live parent chain. An intermediate thread must also belong to the project. */
export async function threadOnBoard(bb:BbPluginApi,board:Board,threadId:string){
 const seen=new Set<string>();
 try{
  const thread=await bb.sdk.threads.get({threadId});
  let current=thread;
  for(;;){
   if(current.projectId!==board.projectId||current.deletedAt!=null||seen.has(current.id))return null;
   if(board.shifts.includes(current.id))return thread;
   if(!current.parentThreadId)return null;
   seen.add(current.id);
   current=await bb.sdk.threads.get({threadId:current.parentThreadId});
  }
 }catch{return null;}
}
