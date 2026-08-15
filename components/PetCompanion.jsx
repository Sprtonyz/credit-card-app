import React, { useEffect, useMemo, useRef, useState } from 'react';
import { resolvePetAnimationMode } from '../utils/petProgression';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const PALETTES = {
  maple: {
    fur: '#d6a574',
    belly: '#f7ead7',
    ear: '#b97f52',
    outline: '#6d4b2e',
    blush: 'rgba(255, 184, 145, 0.55)',
    accent: '#fff7ed',
    shadow: 'rgba(35, 22, 10, 0.22)',
    eye: '#3d2817',
    paw: '#f7ead7',
  },
  mochi: {
    fur: '#e6c3b2',
    belly: '#fff3ea',
    ear: '#c99888',
    outline: '#6e4a42',
    blush: 'rgba(255, 197, 185, 0.6)',
    accent: '#fff7f7',
    shadow: 'rgba(40, 20, 18, 0.2)',
    eye: '#40241f',
    paw: '#fff3ea',
  },
  bluebell: {
    fur: '#a6bfd6',
    belly: '#edf6ff',
    ear: '#7f98b0',
    outline: '#415869',
    blush: 'rgba(187, 219, 255, 0.7)',
    accent: '#f8fcff',
    shadow: 'rgba(20, 32, 46, 0.2)',
    eye: '#28394a',
    paw: '#edf6ff',
  },
  ember: {
    fur: '#e08b5a',
    belly: '#ffeede',
    ear: '#b3542c',
    outline: '#6b3218',
    blush: 'rgba(255, 176, 143, 0.6)',
    accent: '#fffaf3',
    shadow: 'rgba(43, 18, 6, 0.22)',
    eye: '#3a1c0c',
    paw: '#8a4423',
  },
};

const LEAF_DARK = '#8fbf9a';
const LEAF_LIGHT = '#a8d3b2';
const EYE_SHINE = '#fffaf3';

// Pet art is authored in a fixed "unit" space with the origin at the pet's
// centre, matching public/pet-testing/pet-variants.svg. The canvas transform
// scales that space to fit the footer, so every shape below is resolution free.
const ART_EAR_TOP = -112;
const ART_SHADOW_Y = 64;
const ART_BOTTOM = 78;
const ART_HALF_WIDTH = 104;
const ART_HEIGHT = ART_BOTTOM - ART_EAR_TOP;

function fillEllipse(ctx, cx, cy, rx, ry, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function shapeEllipse(ctx, cx, cy, rx, ry, fill, outline, lineWidth = 3) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = outline;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function tracePolygon(ctx, points) {
  ctx.beginPath();
  points.forEach(([px, py], index) => {
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

function shapePolygon(ctx, points, fill, outline, lineWidth = 3) {
  tracePolygon(ctx, points);
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawShadow(ctx, p, pose) {
  const tightness = 1 - Math.min(0.35, Math.max(0, -pose.bodyBob) / 34);
  fillEllipse(ctx, 0, ART_SHADOW_Y, 66 * tightness, 11 * tightness, p.shadow);
}

function drawEyes(ctx, p, pose, eyeX, eyeY) {
  ctx.lineCap = 'round';
  if (pose.eyes === 'closed') {
    ctx.strokeStyle = p.eye;
    ctx.lineWidth = 2.8;
    [-eyeX, eyeX].forEach((ex) => {
      ctx.beginPath();
      ctx.arc(ex, eyeY - 2, 6.5, Math.PI * 0.12, Math.PI * 0.88);
      ctx.stroke();
    });
    return;
  }

  if (pose.eyes === 'happy') {
    ctx.strokeStyle = p.eye;
    ctx.lineWidth = 3;
    [-eyeX, eyeX].forEach((ex) => {
      ctx.beginPath();
      ctx.arc(ex, eyeY + 4, 7, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    });
    return;
  }

  const ry = pose.eyes === 'sad' ? 4.2 : 6.5;
  ctx.fillStyle = p.eye;
  [-eyeX, eyeX].forEach((ex) => {
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, 5, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = EYE_SHINE;
  [-eyeX, eyeX].forEach((ex) => {
    ctx.beginPath();
    ctx.arc(ex + 1.6, eyeY - 2.4, 1.9, 0, Math.PI * 2);
    ctx.fill();
  });

  if (pose.eyes === 'sad') {
    ctx.strokeStyle = p.outline;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-eyeX - 7, eyeY - 10);
    ctx.lineTo(-eyeX + 5, eyeY - 7);
    ctx.moveTo(eyeX + 7, eyeY - 10);
    ctx.lineTo(eyeX - 5, eyeY - 7);
    ctx.stroke();
  }
}

function drawBlush(ctx, p, cx, cy, rx = 9, ry = 5.5) {
  fillEllipse(ctx, -cx, cy, rx, ry, p.blush);
  fillEllipse(ctx, cx, cy, rx, ry, p.blush);
}

function drawMouth(ctx, p, pose, x, y, w) {
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';

  if (pose.mouth === 'open') {
    ctx.fillStyle = '#8f4f4a';
    ctx.beginPath();
    ctx.ellipse(x, y + 4, w * 0.52, 5.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return;
  }

  if (pose.mouth === 'flat') {
    ctx.beginPath();
    ctx.moveTo(x - w * 0.45, y + 2);
    ctx.lineTo(x + w * 0.45, y + 2);
    ctx.stroke();
    return;
  }

  if (pose.mouth === 'frown') {
    ctx.beginPath();
    ctx.moveTo(x - w * 0.55, y + 6);
    ctx.quadraticCurveTo(x, y - 1, x + w * 0.55, y + 6);
    ctx.stroke();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - w * 0.5, y + 6, x - w, y + 3);
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + w * 0.5, y + 6, x + w, y + 3);
  ctx.stroke();
}

function drawFeet(ctx, p, pose, spreadX = 26, footY = 58) {
  shapeEllipse(
    ctx,
    -spreadX + pose.footShift[0],
    footY - pose.footLift[0],
    16,
    9,
    p.paw,
    p.outline
  );
  shapeEllipse(
    ctx,
    spreadX + pose.footShift[1],
    footY - pose.footLift[1],
    16,
    9,
    p.paw,
    p.outline
  );
}

function drawBody(ctx, p, pose, rx = 56, ry = 44) {
  const cy = 20 + pose.bodyBob;
  const squashX = 1 + pose.squash;
  const squashY = 1 - pose.squash;
  shapeEllipse(ctx, 0, cy, rx * squashX, ry * squashY, p.fur, p.outline);
  fillEllipse(ctx, 0, cy + 10 * squashY, rx * 0.61, ry * 0.61 * squashY, p.belly);
}

function drawCatTail(ctx, p, swing) {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(52, 26);
  ctx.quadraticCurveTo(92 + swing, 14, 86 + swing * 1.4, -18 + swing * 0.4);
  ctx.quadraticCurveTo(84 + swing * 1.7, -34, 70 + swing * 1.9, -36 + swing * 0.5);
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 13;
  ctx.stroke();
  ctx.strokeStyle = p.fur;
  ctx.lineWidth = 7;
  ctx.stroke();
}

function drawDogTail(ctx, p, swing) {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(54, 12);
  ctx.quadraticCurveTo(76 + swing * 0.7, 2 - swing * 0.4, 78 + swing * 1.2, -16 + swing * 0.9);
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 14;
  ctx.stroke();
  ctx.strokeStyle = p.fur;
  ctx.lineWidth = 8;
  ctx.stroke();
}

function drawFoxTail(ctx, p, swing) {
  const s = swing;
  ctx.lineJoin = 'round';
  ctx.fillStyle = p.fur;
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(46, 30);
  ctx.quadraticCurveTo(96 + s, 22 + s * 0.3, 96 + s * 1.2, -18 + s * 0.5);
  ctx.quadraticCurveTo(96 + s * 1.35, -44 + s * 0.6, 70 + s * 1.45, -46 + s * 0.6);
  ctx.quadraticCurveTo(86 + s, -24, 78 + s * 0.8, -6);
  ctx.quadraticCurveTo(68 + s * 0.5, 14, 46, 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = p.belly;
  ctx.beginPath();
  ctx.moveTo(96 + s * 1.2, -18 + s * 0.5);
  ctx.quadraticCurveTo(96 + s * 1.35, -44 + s * 0.6, 70 + s * 1.45, -46 + s * 0.6);
  ctx.quadraticCurveTo(84 + s * 1.2, -30 + s * 0.4, 82 + s, -14 + s * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 2.4;
  ctx.stroke();
}

function drawCat(ctx, p, pose) {
  drawShadow(ctx, p, pose);
  drawCatTail(ctx, p, pose.tail);
  drawBody(ctx, p, pose);
  drawFeet(ctx, p, pose);

  ctx.save();
  ctx.translate(pose.headSway, pose.headBob);

  shapePolygon(ctx, [[-40, -56], [-30, -92], [-6, -68]], p.fur, p.outline);
  shapePolygon(ctx, [[-33, -63], [-29, -81], [-17, -69]], p.ear, null);
  shapePolygon(ctx, [[40, -56], [30, -92], [6, -68]], p.fur, p.outline);
  shapePolygon(ctx, [[33, -63], [29, -81], [17, -69]], p.ear, null);

  shapeEllipse(ctx, 0, -32, 43, 43, p.fur, p.outline);
  fillEllipse(ctx, 0, -19, 25, 17, p.belly);
  drawBlush(ctx, p, 29, -24);
  drawEyes(ctx, p, pose, 15, -38);

  shapePolygon(ctx, [[-4, -22], [4, -22], [0, -17]], p.outline, null);
  drawMouth(ctx, p, pose, 0, -17, 12);

  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 1.8;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(-26, -20);
  ctx.lineTo(-44, -23);
  ctx.moveTo(-26, -15);
  ctx.lineTo(-45, -14);
  ctx.moveTo(26, -20);
  ctx.lineTo(44, -23);
  ctx.moveTo(26, -15);
  ctx.lineTo(45, -14);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawDog(ctx, p, pose) {
  drawShadow(ctx, p, pose);
  drawDogTail(ctx, p, pose.tail);
  drawBody(ctx, p, pose, 57, 45);
  drawFeet(ctx, p, pose);

  ctx.save();
  ctx.translate(pose.headSway, pose.headBob);

  // Floppy ears trail behind the head bob for a bit of secondary motion.
  const flop = pose.earFlop;
  ctx.fillStyle = p.ear;
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(-36, -58);
  ctx.quadraticCurveTo(-64 - flop * 0.4, -54, -62 - flop * 0.6, -22 + flop);
  ctx.quadraticCurveTo(-60 - flop * 0.5, -2 + flop * 1.2, -42, -6 + flop * 0.8);
  ctx.quadraticCurveTo(-32, -30, -28, -50);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(36, -58);
  ctx.quadraticCurveTo(64 + flop * 0.4, -54, 62 + flop * 0.6, -22 - flop);
  ctx.quadraticCurveTo(60 + flop * 0.5, -2 - flop * 1.2, 42, -6 - flop * 0.8);
  ctx.quadraticCurveTo(32, -30, 28, -50);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  shapeEllipse(ctx, 0, -32, 43, 43, p.fur, p.outline);
  fillEllipse(ctx, 0, -16, 27, 19, p.belly);
  drawBlush(ctx, p, 30, -24);
  drawEyes(ctx, p, pose, 15, -40);
  fillEllipse(ctx, 0, -22, 7, 5.5, p.outline);
  drawMouth(ctx, p, pose, 0, -14, 13);

  ctx.restore();
}

function drawFox(ctx, p, pose) {
  drawShadow(ctx, p, pose);
  drawFoxTail(ctx, p, pose.tail);
  drawBody(ctx, p, pose);
  drawFeet(ctx, p, pose);

  ctx.save();
  ctx.translate(pose.headSway, pose.headBob);

  shapePolygon(ctx, [[-44, -54], [-40, -104], [-6, -70]], p.fur, p.outline);
  shapePolygon(ctx, [[-40, -104], [-38, -86], [-27, -90]], p.outline, null);
  shapePolygon(ctx, [[44, -54], [40, -104], [6, -70]], p.fur, p.outline);
  shapePolygon(ctx, [[40, -104], [38, -86], [27, -90]], p.outline, null);

  shapeEllipse(ctx, 0, -32, 43, 43, p.fur, p.outline);

  ctx.fillStyle = p.belly;
  ctx.beginPath();
  ctx.moveTo(-30, -14);
  ctx.quadraticCurveTo(0, -46, 30, -14);
  ctx.quadraticCurveTo(0, 4, -30, -14);
  ctx.closePath();
  ctx.fill();

  drawBlush(ctx, p, 31, -26);
  drawEyes(ctx, p, pose, 16, -40);
  fillEllipse(ctx, 0, -18, 6.5, 5, p.eye);
  drawMouth(ctx, p, pose, 0, -12, 13);

  ctx.restore();
}

function drawBlob(ctx, p, pose) {
  drawShadow(ctx, p, pose);

  const bob = pose.bodyBob;
  const squashX = 1 + pose.squash;
  const squashY = 1 - pose.squash;

  ctx.save();
  ctx.translate(0, bob);
  ctx.scale(squashX, squashY);

  // Sprout replaces ears and tail, and lags behind the hop.
  const lean = pose.tail * 0.45;
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -78);
  ctx.quadraticCurveTo(2 + lean * 0.5, -96, lean, -104);
  ctx.stroke();

  ctx.lineJoin = 'round';
  ctx.fillStyle = LEAF_DARK;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(lean * 0.9, -100);
  ctx.quadraticCurveTo(-20 + lean, -108, -22 + lean, -92);
  ctx.quadraticCurveTo(-6 + lean, -88, lean * 0.9, -100);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = LEAF_LIGHT;
  ctx.beginPath();
  ctx.moveTo(lean * 0.8, -96);
  ctx.quadraticCurveTo(18 + lean, -104, 21 + lean, -88);
  ctx.quadraticCurveTo(6 + lean, -85, lean * 0.8, -96);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = p.fur;
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -80);
  ctx.bezierCurveTo(46, -80, 70, -44, 70, -6);
  ctx.bezierCurveTo(70, 36, 44, 62, 0, 62);
  ctx.bezierCurveTo(-44, 62, -70, 36, -70, -6);
  ctx.bezierCurveTo(-70, -44, -46, -80, 0, -80);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  fillEllipse(ctx, 0, 18, 40, 32, p.belly);

  shapeEllipse(ctx, -64, 6 - pose.footLift[0] * 0.6, 13, 10, p.fur, p.outline);
  shapeEllipse(ctx, 64, 6 - pose.footLift[1] * 0.6, 13, 10, p.fur, p.outline);

  drawBlush(ctx, p, 32, -16, 9.5, 5.5);
  drawEyes(ctx, p, pose, 16, -30);

  if (pose.mouth === 'open') {
    drawMouth(ctx, p, pose, 0, -14, 12);
  } else if (pose.mouth === 'frown') {
    ctx.strokeStyle = p.eye;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-9, -8);
    ctx.quadraticCurveTo(0, -16, 9, -8);
    ctx.stroke();
  } else if (pose.mouth === 'flat') {
    ctx.strokeStyle = p.eye;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-8, -12);
    ctx.lineTo(8, -12);
    ctx.stroke();
  } else {
    ctx.strokeStyle = p.eye;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-9, -12);
    ctx.quadraticCurveTo(0, -4, 9, -12);
    ctx.stroke();
  }

  ctx.restore();
}

const STYLE_RENDERERS = {
  cat: drawCat,
  dog: drawDog,
  fox: drawFox,
  blob: drawBlob,
};

function drawSparkles(ctx, tick) {
  const points = [
    [-70, -60],
    [72, -52],
    [-52, -92],
    [58, -96],
  ];
  points.forEach(([sx, sy], index) => {
    const pulse = 0.45 + 0.55 * Math.abs(Math.sin(tick / 9 + index * 1.4));
    const r = 5 * pulse;
    ctx.fillStyle = `rgba(255, 214, 133, ${pulse.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(sx, sy - r);
    ctx.quadraticCurveTo(sx, sy, sx + r, sy);
    ctx.quadraticCurveTo(sx, sy, sx, sy + r);
    ctx.quadraticCurveTo(sx, sy, sx - r, sy);
    ctx.quadraticCurveTo(sx, sy, sx, sy - r);
    ctx.closePath();
    ctx.fill();
  });
}

function drawFoodOrb(ctx, p, tick) {
  const y = -6 + Math.sin(tick / 6) * 3;
  shapeEllipse(ctx, 54, y, 9, 9, '#f59e0b', p.outline, 2.6);
  fillEllipse(ctx, 51, y - 3, 3, 2.4, 'rgba(255,255,255,0.6)');
}

function buildPose(mode, tick) {
  const step = tick * 0.17;
  const breathe = Math.sin(tick / 26);

  const pose = {
    mode,
    step,
    bodyBob: breathe * 1.2,
    headBob: breathe * 1,
    headSway: 0,
    tail: Math.sin(tick / 34) * 3,
    earFlop: Math.sin(tick / 30) * 1.2,
    footLift: [0, 0],
    footShift: [0, 0],
    squash: 0,
    eyes: 'open',
    mouth: 'smile',
    sparkle: false,
    food: false,
  };

  if (mode === 'walk') {
    // Alternating march: each foot lifts on its half of the cycle while the
    // body rises on the push-off and the head/tail trail slightly behind.
    pose.footLift = [
      Math.max(0, Math.sin(step)) * 8,
      Math.max(0, Math.sin(step + Math.PI)) * 8,
    ];
    pose.footShift = [Math.cos(step) * 4, Math.cos(step + Math.PI) * 4];
    pose.bodyBob = -Math.abs(Math.sin(step)) * 2.8;
    pose.headBob = -Math.abs(Math.sin(step + 0.5)) * 2.4;
    pose.headSway = Math.sin(step) * 2.4;
    pose.tail = Math.sin(step * 0.9) * 9;
    pose.earFlop = Math.sin(step - 0.7) * 4.5;
    pose.squash = Math.abs(Math.cos(step)) * 0.03;
  } else if (mode === 'celebrate') {
    const hop = Math.abs(Math.sin(step * 0.85));
    pose.bodyBob = -hop * 12;
    pose.headBob = -hop * 14;
    pose.headSway = Math.sin(step * 0.85) * 3;
    pose.footLift = [hop * 10, hop * 10];
    pose.tail = Math.sin(step * 1.7) * 13;
    pose.earFlop = -hop * 6;
    pose.squash = (1 - hop) * 0.06;
    pose.eyes = 'happy';
    pose.mouth = 'open';
    pose.sparkle = true;
  } else if (mode === 'feed') {
    const chew = Math.sin(step * 1.5);
    pose.bodyBob = Math.sin(step) * 2.4;
    pose.headBob = chew * 2.2;
    pose.tail = Math.sin(step * 1.2) * 11;
    pose.earFlop = chew * 2.5;
    pose.eyes = 'happy';
    pose.mouth = chew > 0 ? 'open' : 'smile';
    pose.food = true;
  } else if (mode === 'sleep') {
    const slow = Math.sin(tick / 44);
    pose.bodyBob = slow * 2.2;
    pose.headBob = slow * 1.8 + 6;
    pose.tail = slow * 2;
    pose.earFlop = slow * 1.5 + 2;
    pose.squash = 0.05;
    pose.eyes = 'closed';
    pose.mouth = 'flat';
  } else if (mode === 'sad') {
    const droop = Math.sin(tick / 40);
    pose.bodyBob = droop * 0.8 + 2;
    pose.headBob = droop * 0.6 + 8;
    pose.headSway = droop * 0.8;
    pose.tail = -7 + droop * 1.2;
    pose.earFlop = 5 + droop;
    pose.eyes = 'sad';
    pose.mouth = 'frown';
  }

  return pose;
}

function drawVariant(ctx, style, palette, pose, tick) {
  const renderer = STYLE_RENDERERS[style] || STYLE_RENDERERS.cat;
  renderer(ctx, palette, pose);
  if (pose.food) drawFoodOrb(ctx, palette, tick);
  if (pose.sparkle) drawSparkles(ctx, tick);
}

function getMoodBubble(mood) {
  if (mood === 'excited') return '!';
  if (mood === 'content') return '~';
  if (mood === 'sleepy') return 'z';
  if (mood === 'hungry') return '*';
  if (mood === 'neglected') return '...';
  return '';
}

export default function PetCompanion({
  pet,
  footerHeight = 132,
  scalePercent = 100,
}) {
  const canvasRef = useRef(null);
  const [, setAnimationExpiry] = useState(0);
  const animationState = resolvePetAnimationMode(pet);
  const palette = PALETTES[pet?.identity?.palette] || PALETTES.maple;
  const companionStyle = STYLE_RENDERERS[pet?.identity?.companionStyle] ? pet.identity.companionStyle : 'cat';
  const homeAnchor = pet?.identity?.homeAnchor === 'right' ? 'right' : 'left';
  const bubble = getMoodBubble(pet?.mood);

  const metrics = useMemo(() => {
    const scale = clamp(Number(scalePercent) || 100, 60, 160) / 100;
    const height = Math.max(72, Number(footerHeight) || 132);
    const groundY = height - 12;
    // Fit the authored art to the available footer height instead of reserving
    // a large dead zone above it; clipping is still prevented by maxUnit.
    const maxUnit = (groundY - 4) / (ART_SHADOW_Y - ART_EAR_TOP);
    const unit = Math.min(maxUnit, (height * scale) / ART_HEIGHT);
    return {
      unit,
      groundY,
      originY: groundY - ART_SHADOW_Y * unit,
      halfWidth: ART_HALF_WIDTH * unit,
    };
  }, [footerHeight, scalePercent]);

  useEffect(() => {
    const until = Number(pet?.animation?.until || 0);
    const remaining = until - Date.now();
    if (remaining <= 0) return undefined;

    const timer = window.setTimeout(() => setAnimationExpiry((value) => value + 1), remaining + 20);
    return () => window.clearTimeout(timer);
  }, [pet?.animation?.mode, pet?.animation?.until]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let tick = 0;

    const facesRight = homeAnchor !== 'right';
    let direction = facesRight ? 1 : -1;
    let x = 0;
    let minX = 0;
    let maxX = 0;

    const resize = () => {
      canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
      canvas.height = footerHeight;

      const margin = 10;
      minX = margin + metrics.halfWidth;
      maxX = canvas.width - margin - metrics.halfWidth;
      if (maxX < minX) {
        minX = canvas.width / 2;
        maxX = minX;
      }
      x = clamp(x || (facesRight ? minX : maxX), minX, maxX);
    };

    const travelSpeed = animationState === 'celebrate' ? 1.9 : 1.05;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, metrics.groundY, canvas.width, 1);

      if (animationState === 'walk' || animationState === 'celebrate') {
        x += direction * travelSpeed;
        if (x >= maxX) {
          x = maxX;
          direction = -1;
        }
        if (x <= minX) {
          x = minX;
          direction = 1;
        }
      }

      tick += 1;
      const pose = buildPose(animationState, tick);

      ctx.save();
      ctx.translate(x, metrics.originY);
      ctx.scale(direction < 0 ? -metrics.unit : metrics.unit, metrics.unit);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      drawVariant(ctx, companionStyle, palette, pose, tick);
      ctx.restore();

      if (bubble) {
        // Sit the bubble clear of the tallest ears/sprout and inside the canvas.
        const rawX = x + 64 * metrics.unit * direction;
        const bubbleX = clamp(rawX, 16, Math.max(16, canvas.width - 16));
        const bubbleY = Math.max(
          14,
          metrics.originY - 104 * metrics.unit + pose.headBob * metrics.unit
        );
        ctx.fillStyle = 'rgba(15,23,42,0.78)';
        ctx.beginPath();
        ctx.roundRect(bubbleX - 13, bubbleY - 10, 26, 20, 10);
        ctx.fill();
        ctx.fillStyle = '#f8fafc';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(bubble, bubbleX, bubbleY + 1);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }

      raf = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    raf = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [animationState, bubble, companionStyle, footerHeight, homeAnchor, metrics, palette]);

  return <canvas ref={canvasRef} />;
}
