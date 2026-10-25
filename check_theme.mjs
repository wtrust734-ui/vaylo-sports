import { readFileSync } from 'fs';
const css = readFileSync('site/theme.css','utf8');
const lines = css.split('\n');
const hits = ['cap-underline','tbl-row','prsOnly','grayscale'];
for (let i=0;i<lines.length;i++){
  const l = lines[i];
  if (hits.some(h => l.includes(h))){
    console.log((i+1)+': '+l);
  }
}
