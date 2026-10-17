import { rng } from './rng.js';
// Illustrative fixtures, not trained or validated probabilities.
export const LOOKS={zone:{label:'Cover 2',complete:.65,incomplete:.25,sack:.07,int:.03},man:{label:'Man coverage',complete:.57,incomplete:.31,sack:.08,int:.04},blitz:{label:'Nickel blitz',complete:.57,incomplete:.23,sack:.16,int:.04}};
export function sample(look,seed){
 if(!LOOKS[look]||!Number.isSafeInteger(seed)||seed<0)throw Error('Invalid look/seed');
 const rand=rng('what-if:'+look+':'+seed);let u=rand(),kind='int',c=0;
 for(const [key,p] of Object.entries(LOOKS[look])){if(key==='label')continue;c+=p;if(u<c){kind=key;break}}
 const air=4+Math.floor(rand()*5),yac=kind==='complete'?Math.floor(rand()*8)+(rand()<.1?7:0):0;
 const gain=kind==='complete'?air+yac:kind==='sack'?-(3+Math.floor(rand()*6)):0;
 return {kind,air,yac,gain,converted:kind==='complete'&&gain>=3,probability:LOOKS[look][kind]};
}
export function generate(game,look,seed){
 const template=game.plays.find(p=>p.off===game.home&&p.lineup?.[p.off]?.QB&&p.lineup?.[p.off]?.WR1&&p.lineup?.[p.def]?.RCB&&p.q===4)
 ||game.plays.find(p=>p.off===game.home&&p.lineup?.[p.off]?.QB&&p.lineup?.[p.off]?.WR1);
 if(!template)throw Error('Home team lineup unavailable');
 const lineup=JSON.parse(JSON.stringify(template.lineup)),off=lineup[game.home],def=lineup[game.away],result=sample(look,seed);
 const play={id:'whatif-'+look+'-'+seed,drive:0,q:4,clock:'2:14',off:game.home,def:game.away,
 kind:result.kind,concept:'slant',coverage:look,down:3,dist:3,los:28,dir:-1,
 shotgun:true,noHuddle:false,air:result.air,yac:result.yac,gain:result.gain,loc:'middle',
 qb:off.QB,target:result.kind==='sack'?null:off.WR1,lineup,tacklers:[],oob:false,td:false,scoring:false,
 score:[21,17],text:'Hypothetical slant: illustrative sampled outcome.'};
 if(result.kind==='sack')play.sackers=[def.REDGE||def.LEDGE].filter(Boolean);
 if(result.kind==='int'){play.interceptor=def.RCB||def.LCB;play.end=35;}
 if(result.kind==='incomplete'&&look==='man')play.defender=def.RCB||def.LCB;
 return {play,result,look,seed};
}