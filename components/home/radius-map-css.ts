/*
  Radius map styles that Tailwind classes cannot say: placement-dependent layout, the container query and the motion. Rendered by
  radius-map.tsx as one small <style> (React hoists and de-duplicates it by href). Class names start with "hm-".
  The sizes (22 px dots, 13 px labels with 3 px / 7 px padding on a 20 px line, 16 px label offset, 13 px captions and chip) are the
  numbers lib/seo/home-place.ts places with; change them together. Not a CSS module: next.config.ts sends every *.css file through
  the Tailwind loader as plain CSS, so module class names would not be scoped.
*/
export const RADIUS_MAP_CSS = `
.hm-fig {
container-type: inline-size;
}
.hm-dot {
position: absolute;
width: 22px;
height: 22px;
box-sizing: border-box;
transform: translate(-50%, -50%);
opacity: 0;
animation: hm-hdot 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}
.hm-label {
position: absolute;
white-space: nowrap;
font-size: 13px;
line-height: 20px;
padding: 3px 7px;
letter-spacing: 0;
opacity: 0;
animation: hm-hlabel 0.5s ease-out forwards;
}
.hm-right {
transform: translate(16px, -50%);
}
.hm-left {
transform: translate(calc(-100% - 16px), -50%);
}
.hm-caption {
position: absolute;
left: 50%;
transform: translate(-50%, -50%);
font-size: 13px;
line-height: 20px;
padding: 0 6px;
}
.hm-chip {
position: absolute;
left: 50%;
top: 50%;
transform: translate(-50%, -50%);
font-size: 13px;
line-height: 20px;
padding: 6px 10px;
}
.hm-pulse {
position: absolute;
left: 50%;
top: 50%;
width: 92%;
height: 92%;
box-sizing: border-box;
border-radius: 50%;
transform: translate(-50%, -50%);
opacity: 0;
animation: hm-hpulse 2.4s ease-out 2;
}
.hm-num {
display: none;
}
.hm-key {
display: none;
}
@container (max-width: 519px) {
.hm-label {
display: none;
}
.hm-num {
display: flex;
}
.hm-key {
display: grid;
grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
gap: 6px 16px;
}
}
@keyframes hm-hdot {
0% {
opacity: 0;
transform: translate(-50%, -50%) scale(0.3);
}
60% {
opacity: 1;
transform: translate(-50%, -50%) scale(1.25);
}
100% {
opacity: 1;
transform: translate(-50%, -50%) scale(1);
}
}
@keyframes hm-hlabel {
from {
opacity: 0;
}
to {
opacity: 1;
}
}
@keyframes hm-hpulse {
0% {
opacity: 0.55;
transform: translate(-50%, -50%) scale(0.2);
}
100% {
opacity: 0;
transform: translate(-50%, -50%) scale(1);
}
}
@media (prefers-reduced-motion: reduce) {
.hm-dot,
.hm-label {
animation: none;
opacity: 1;
}
.hm-pulse {
animation: none;
opacity: 0;
}
}
`;
