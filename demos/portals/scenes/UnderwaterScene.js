// Underwater scene: raycast jellyfish bloom, whale shark passing,
// rising bubble columns, sunbeam shafts, sandy floor — same 3D content
// as UnderwaterImmersive so the disc preview matches what's inside.
export const UnderwaterScene = {
  name: 'Underwater',

  ringCool: 'vec3(0.10, 0.55, 0.85)',
  ringWarm: 'vec3(0.25, 0.95, 0.85)',
  haloInner: 'vec3(0.20, 0.70, 1.00)',
  haloOuter: 'vec3(0.30, 1.00, 0.85)',

  helpers: /* glsl */ `
    float caustic2(vec2 uv, float t) {
      vec2 p = uv * 0.6;
      float v = 0.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        v += sin(p.x * (1.0 + fi * 0.4) + t * (0.7 + fi * 0.2))
           * sin(p.y * (1.3 + fi * 0.3) + t * (0.9 - fi * 0.15));
      }
      return pow(max(v * 0.33 + 0.5, 0.0), 2.5);
    }

    // Glowing jellyfish bell + halo, projected on the ray at world pos.
    vec3 jellyfish3D(vec3 ro, vec3 rd, vec3 pos, float t, float seed) {
      vec3 oc = pos - ro;
      float along = dot(oc, rd);
      if (along < 0.5 || along > 25.0) return vec3(0.0);
      vec3 proj = ro + rd * along;
      float d = length(pos - proj);
      float bellR = 0.5 + 0.1 * sin(t * 1.2 + seed * 7.0);
      float bell = smoothstep(bellR, 0.0, d) * 0.55;
      float halo = smoothstep(bellR * 3.0, bellR, d) * 0.18;
      float fade = 1.0 / (1.0 + along * 0.08);
      vec3 color = mix(vec3(0.4, 0.85, 1.0), vec3(0.85, 0.55, 1.0),
                       sin(t + seed) * 0.5 + 0.5);
      return color * (bell + halo) * fade;
    }

    // Whale shark drifting in a slow horizontal arc.
    vec3 whaleShark3D(vec3 ro, vec3 rd, float t) {
      float phase = t * 0.04;
      vec3 pos = vec3(sin(phase) * 18.0,
                      -3.0 + sin(t * 0.1) * 0.5,
                      cos(phase) * 18.0 - 4.0);
      vec3 oc = pos - ro;
      float along = dot(oc, rd);
      if (along < 1.0 || along > 40.0) return vec3(0.0);
      vec3 proj = ro + rd * along;
      vec3 d = pos - proj;
      vec3 fwd = vec3(cos(phase), 0.0, -sin(phase));
      float along2 = dot(d, fwd);
      vec3 perp = d - fwd * along2;
      float body = smoothstep(0.6, 0.0,
                              length(vec2(along2 / 4.0, length(perp))));
      float tail = smoothstep(0.6, 0.0,
                              length(vec2((along2 - 4.0) / 1.5,
                                          length(perp) * 2.0)));
      float silhouette = max(body, tail * 0.7);
      float fade = 1.0 / (1.0 + along * 0.05);
      float spot = hash(floor(perp.xy * 30.0 + along2));
      vec3 bodyCol = mix(vec3(0.06, 0.10, 0.14),
                         vec3(0.18, 0.25, 0.30), spot);
      return bodyCol * silhouette * fade;
    }

    // Rising bubble columns at fixed (hashed) xz positions.
    vec3 bubbles3D(vec3 ro, vec3 rd, float t) {
      vec3 col = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float seed = fi * 13.7;
        vec2 base = vec2(sin(seed) * 8.0 + cos(seed * 1.3) * 4.0,
                         cos(seed * 0.7) * 8.0 + sin(seed * 1.1) * 4.0);
        float bh = mod(t * 1.5 + seed * 3.0, 6.0) - 1.0;
        vec3 pos = vec3(base.x + sin(bh + seed) * 0.15,
                        -2.5 + bh,
                        base.y + cos(bh + seed) * 0.15);
        vec3 oc = pos - ro;
        float along = dot(oc, rd);
        if (along < 0.3 || along > 20.0) continue;
        vec3 proj = ro + rd * along;
        float d = length(pos - proj);
        float r = 0.05 + 0.02 * sin(bh * 4.0 + seed);
        float bubble = smoothstep(r, 0.0, d) * 0.4;
        float fade = 1.0 / (1.0 + along * 0.15);
        col += vec3(0.85, 0.95, 1.00) * bubble * fade;
      }
      return col;
    }

    // Volumetric sunbeam shafts when looking up.
    float sunbeams3D(vec3 ro, vec3 rd, float t) {
      if (rd.y < 0.05) return 0.0;
      float density = 0.0;
      float surfaceY = 8.0;
      for (int i = 1; i <= 12; i++) {
        float fi = float(i);
        float along = fi * 0.7;
        vec3 sp = ro + rd * along;
        float depthFactor = clamp(sp.y / surfaceY, 0.0, 1.0);
        float c = caustic2(sp.xz, t);
        density += c * depthFactor * 0.05;
      }
      density *= pow(max(rd.y, 0.0), 0.6);
      return density;
    }
  `,

  body: /* glsl */ `
    vec3 ro = uCamLocal;
    float t = uTime;

    // Vertical depth gradient (above eye = brighter, below = abyss).
    vec3 surfaceCol = vec3(0.20, 0.65, 0.85);
    vec3 midCol     = vec3(0.05, 0.30, 0.55);
    vec3 abyssCol   = vec3(0.005, 0.020, 0.075);
    float depthT = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
    col = mix(abyssCol, midCol, smoothstep(0.25, 0.55, depthT));
    col = mix(col, surfaceCol, smoothstep(0.55, 0.95, depthT));

    // Surface caustics + sun disc when looking up.
    if (rd.y > 0.3) {
      float surfaceY = 8.0;
      float kt = (surfaceY - ro.y) / rd.y;
      if (kt > 0.0) {
        vec3 sp = ro + rd * kt;
        float c = caustic2(sp.xz, t);
        col = mix(col, vec3(0.95, 1.00, 0.75),
                  c * smoothstep(0.3, 0.95, rd.y) * 0.55);
        vec3 sunDir = normalize(vec3(0.2, 1.0, -0.3));
        float sa = max(dot(rd, sunDir), 0.0);
        col += vec3(1.00, 0.95, 0.75)
             * smoothstep(0.965, 0.995, sa) * 0.9;
        col += vec3(1.00, 0.95, 0.75)
             * smoothstep(0.85, 1.0, sa) * 0.25;
      }
    }

    // Volumetric sunbeams.
    col += vec3(0.80, 0.95, 1.00) * sunbeams3D(ro, rd, t) * 1.4;

    // Sandy ocean floor.
    if (rd.y < -0.1) {
      float gt = -ro.y - 6.0;
      float t2 = gt / rd.y;
      if (t2 > 0.0 && t2 < 80.0) {
        vec3 gp = ro + rd * t2;
        float gn = fbm(gp.xz * 0.15);
        vec3 ground = mix(vec3(0.05, 0.10, 0.12),
                          vec3(0.10, 0.18, 0.20), gn);
        float fog = smoothstep(0.0, 35.0, t2);
        col = mix(ground, col, fog);
      }
    }

    // Drifting jellyfish bloom.
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float seed = fi * 11.3;
      vec3 jp = vec3(
        sin(t * 0.2 + seed) * 5.0 + cos(seed * 1.7) * 3.0,
        0.5 + sin(t * 0.3 + seed * 0.7) * 2.0,
        cos(t * 0.25 + seed) * 5.0 + sin(seed * 0.9) * 3.0);
      col += jellyfish3D(ro, rd, jp, t, seed);
    }

    // Whale shark passing.
    col += whaleShark3D(ro, rd, t);

    // Rising bubble columns.
    col += bubbles3D(ro, rd, t);

    // Mild blue haze.
    col = mix(col, midCol, 0.14);
  `,
};
