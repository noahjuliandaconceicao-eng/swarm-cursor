// Point-sprite shaders. Positions are simulated on the CPU (cheap at <=20k points)
// so the cursor physics can carry real inertia; everything visual lives here.

export const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aSpeed;
  attribute float aSeed;
  attribute vec3 aTint;

  uniform float uPixelRatio;
  uniform float uFocus;       // camera distance to the focal plane (z = 0)
  uniform float uAperture;    // depth-of-field strength
  uniform float uTime;
  uniform float uScale;       // global point-size multiplier (responsive)

  varying vec3 vColor;
  varying float vAlpha;
  varying float vSoft;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = -mv.z;

    // Circle of confusion: out-of-focus particles grow, soften and fade.
    float coc = abs(dist - uFocus) / uFocus * uAperture;

    float twinkle = 0.85 + 0.15 * sin(uTime * (1.2 + aSeed * 2.4) + aSeed * 40.0);
    float size = aSize * uScale * (1.0 + aSpeed * 0.9);
    gl_PointSize = (size + coc * 10.0) * uPixelRatio * (uFocus / max(dist, 1.0));
    gl_PointSize = clamp(gl_PointSize, 1.0, 64.0 * uPixelRatio);

    vec3 ember = vec3(1.0, 0.36, 0.22);
    vec3 col = mix(aTint, ember, smoothstep(0.15, 0.9, aSpeed) * 0.85);
    col += aSpeed * 0.25;

    vColor = col;
    vAlpha = twinkle / (1.0 + coc * coc * 3.0);
    vSoft = clamp(coc * 0.8, 0.0, 1.0);

    gl_Position = projectionMatrix * mv;
  }
`;

export const fragmentShader = /* glsl */ `
  uniform float uOpacity;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vSoft;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    // Sharp core for in-focus points, wide gaussian for bokeh.
    float core = smoothstep(0.5, 0.0, d);
    float sharp = pow(core, 2.2);
    float soft = core * 0.55;
    float a = mix(sharp, soft, vSoft) * vAlpha * uOpacity;
    gl_FragColor = vec4(vColor, a); // additive blending: src * alpha + dst
  }
`;
