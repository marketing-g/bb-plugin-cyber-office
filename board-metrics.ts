import type {BoardRow,BoardStatus} from './board';

/** Один переход, включая старые строки без счётчиков. Повтор записи статус не меняет. */
export function updateRowStatus(row:BoardRow,status:BoardStatus,at:number,critic= row.critic){
 const was=row.status;
 if(was==='waiting'&&status!=='waiting'){
  row.waitedMs=(row.waitedMs??0)+Math.max(0,at-(row.waitingSince??row.updatedAt));
  delete row.waitingSince;
 }
 if(status==='waiting'&&row.waitingSince==null)row.waitingSince=was==='waiting'?row.updatedAt:at;
 const newRework=critic?.verdict==='rework'&&JSON.stringify(critic)!==JSON.stringify(row.critic);
 if((was==='review'&&status==='working')||newRework)row.reworks=(row.reworks??0)+1;
 row.status=status;row.updatedAt=at;
 if(critic!==undefined)row.critic=critic;
}
