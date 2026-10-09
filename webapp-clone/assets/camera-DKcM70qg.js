import{E as c,bF as i}from"./index-BgfS_xTn.js";/**
 * @license lucide-react v0.462.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const u=c("Camera",[["path",{d:"M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z",key:"1tc9qg"}],["circle",{cx:"12",cy:"13",r:"3",key:"1vg3eu"}]]);let r;async function n(){return r!==void 0||(r=await i("VayloCamera")),r}async function l(){const a=await n();if(!a)return null;try{return t(await a.capture())}catch{return null}}async function m(){const a=await n();if(!a)return null;try{return t(await a.pick())}catch{return null}}function t(a){if(!(a!=null&&a.dataUrl))return null;const e=a.mimeType??"image/jpeg";return{base64:a.dataUrl,previewUrl:a.dataUrl,mimeType:e}}export{u as C,l as c,m as p};
