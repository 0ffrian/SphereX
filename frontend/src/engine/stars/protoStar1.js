/* eslint-disable */
// @ts-nocheck
// Issue #71, D-37: the approved prototype's star and flare engine, extracted MECHANICALLY and unchanged except for the
// @rename pairs declared below (two hooks for the app, and the deviations listed under them).
// Source: .claude/worktrees/sculptor-reference/sculptor-preview-next.html, lines 357-662 (Planck colour, star shader FS, star model, tauC, drawStar).
// Not yet imported by the app: it still needs the TypeScript host (DOM removed, `cardToStar`). Do not edit here;
// re-run the slicing instead so the body stays byte-identical to the prototype.
// Deliberate deviations from the prototype (PR #89 review, Atish's call), declared as the last @rename pairs (four from PR #89, three from #93):
//  1. Limb darkening: the prototype's T^4 ~ 0.4 + 0.6 mu pinned the disc centre at Teff (the star drawn as if at
//     0.946 Teff). Now the Eddington approximation T^4 = 3/4 Teff^4 (mu + 2/3), so T = Teff at mu = 2/3 and the
//     centre is 1.25^(1/4) = 1.0574 Teff; the brightness pow(tl/uTeff, beta) is divided by 1.0574^beta so the
//     centre intensity is unchanged. model_dependent (grey-atmosphere approximation).
//  2. Spot temperature: the prototype's umbra was a fixed 0.68 Teff, which over-darkens M-dwarf spots. Now the
//     umbra is cooler than the surface by dT = clamp(350 + 0.6 (Teff - 3300), 200, 2000) K, a linear fit to the
//     trend in Berdyugina 2005 (Living Rev. Sol. Phys. 2, 8, fig. 7): about 2,000 K at G0, a few hundred K at
//     M4. The Sun's umbra stays at 3,939 K (was 3,925 K). The penumbra keeps the prototype's share of the
//     umbra's deficit (0.885 + 0.05 fil on the Sun = 1 - dT/Teff (0.36 - 0.16 fil)). inferred_from_analog;
//     the fit coefficients are [verify].
//  3. X10 flare readout: the prototype's "about every 300 f_sun/f days" is 2.5 to 3 times too frequent for the
//     Sun (GOES since 1976: about one flare >= X10 per 800 to 1,000 days). Now 900 f_sun/f days. inferred_from_analog.
//  4. (#93 3.4) Convective turnover time: the prototype's tauC(M) is the Wright et al. 2011 mass fit, but the field
//     law it feeds (199 Ro^-1.26, 2050 Ro^-0.11) is Reiners et al. 2022 (A&A 662, A41), whose Rossby number uses
//     tau = 12.3 d (L/Lsun)^-1/2. tauC now takes the star (tauC(p.M) => tauC(p)) and returns 12.3 / sqrt(L), with
//     L = R^2 (T / 5772 K)^4 (Stefan-Boltzmann, IAU 2015 B3 nominal solar Teff); the old body is left unreachable.
//     The solar anchor B_SUN uses the same tau (12.3 d, so Ro_sun = 25.4 / 12.3 = 2.07, field 80 G; was 1.76 and
//     98 G); spot coverage is relative to B_SUN, so the Sun's coverage is unchanged. Barnard's Star (about
//     0.0035 Lsun): tau about 208 d (was 101 d). Same law as physics/stellar.ts turnoverTimeDays. model_dependent.
// Not changed but labelled: the granulation contrast (+-12 % in temperature, `(gran-.5)*.24`) is 2 to 3 times the
// observed one, exaggerated so the cells show at this scale: artistic.
// @verbatim L358-L663
// @rename m.best=>(CLOSE_AT||m.best) (ema=>(!window.__sxPin&&ema pow(.4+.6*mu,.25)=>pow(.75*mu+.5,.25) pow(tl/uTeff,uBeta)=>pow(tl/uTeff/1.0574,uBeta) tt=mix(1.,.885+.05*fil,mpn);tt=mix(tt,.68,um);=>tt=mix(1.,1.-clamp(350.+.6*(uTeff-3300.),200.,2000.)/uTeff*(.36-.16*fil),mpn);tt=mix(tt,1.-clamp(350.+.6*(uTeff-3300.),200.,2000.)/uTeff,um); m.f;=>m.f*3; tauC(p.M)=>tauC(p) Math.log10(M);=>0;return(12.3/Math.sqrt(M.R*M.R*Math.pow(M.T/5772,4))); 1.16),=>1.16)*Math.pow(10,1.16)/12.3,
/* ---------- Planck spectrum to colour ---------- */
function g(l, m, s1, s2) {
  var s = l < m ? s1 : s2,
    t = (l - m) / s;
  return Math.exp(-0.5 * t * t);
}
function planckRGB(T) {
  var X = 0,
    Y = 0,
    Z = 0,
    l;
  for (l = 380; l <= 780; l += 5) {
    var m = l * 1e-9,
      B = 1 / (Math.pow(m, 5) * (Math.exp(0.014388 / (m * T)) - 1));
    X +=
      B *
      (1.056 * g(l, 599.8, 37.9, 31.0) +
        0.362 * g(l, 442.0, 16.0, 26.7) -
        0.065 * g(l, 501.1, 20.4, 26.2));
    Y += B * (0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1));
    Z += B * (1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8));
  }
  var r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    gg = -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    b = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  r = Math.max(r, 0);
  gg = Math.max(gg, 0);
  b = Math.max(b, 0);
  var mx = Math.max(r, gg, b);
  return [r / mx, gg / mx, b / mx];
}
var LUT_MIN = Math.log(1200),
  LUT_MAX = Math.log(60000),
  LUT = new Uint8Array(512 * 4);
(function () {
  for (var i = 0; i < 512; i++) {
    var c = planckRGB(Math.exp(lerp(LUT_MIN, LUT_MAX, i / 511)));
    LUT[i * 4] = c[0] * 255;
    LUT[i * 4 + 1] = c[1] * 255;
    LUT[i * 4 + 2] = c[2] * 255;
    LUT[i * 4 + 3] = 255;
  }
})();
function hex(c) {
  return (
    '#' +
    c
      .map(function (x) {
        return Math.round(255 * Math.pow(x, 1 / 2.2))
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

/* ---------- star shader ---------- */
var VS =
  '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}';
var FS = `#version 300 es
precision highp float;
uniform vec2 uRes,uOff;
uniform float uTime,uTeff,uFreq,uConv,uHalf,uRot,uTilt,uBeta,uFilter;
uniform vec4 uSpots[48];
uniform int uN;
uniform sampler2D uLut;
out vec4 O;
const float LMIN=${LUT_MIN.toFixed(6)},LMAX=${LUT_MAX.toFixed(6)};
vec3 h33(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);return fract((p.xxy+p.yxx)*p.zyx);}
float vn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(h33(i).x,h33(i+vec3(1,0,0)).x,f.x),mix(h33(i+vec3(0,1,0)).x,h33(i+vec3(1,1,0)).x,f.x),f.y),
            mix(mix(h33(i+vec3(0,0,1)).x,h33(i+vec3(1,0,1)).x,f.x),mix(h33(i+vec3(0,1,1)).x,h33(i+vec3(1,1,1)).x,f.x),f.y),f.z);}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+vec3(7.1,3.3,1.7);a*=.5;}return s/.9375;}
float ridged(vec3 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*(1.-abs(2.*vn(p)-1.));p=p*2.1+vec3(3.1,9.3,4.7);a*=.5;}return s/.9375;}
vec3 lut(float T){return texture(uLut,vec2((log(T)-LMIN)/(LMAX-LMIN),.5)).rgb;}
/* A cell is born small, grows, shows a dark core as it splits, then shrinks while its neighbours fill in. */
float boil(vec3 p,float t){
 vec3 ip=floor(p),fp=fract(p);float f1=9.,f2=9.,pf=0.;
 for(int k=-1;k<=1;k++)for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
  vec3 g=vec3(i,j,k),c=ip+g,h=h33(c);
  float ph=t*(.7+.6*h.x)+h.y*7.,ep=floor(ph),fr=ph-ep;
  vec3 o=h33(c+ep*vec3(13.1,7.7,3.3));
  float s=.3+.85*smoothstep(0.,.35,fr)*(1.-smoothstep(.72,1.,fr));
  float d=length(g+o-fp)/s;
  if(d<f1){f2=f1;f1=d;pf=fr;}else if(d<f2){f2=d;}
 }
 float lane=smoothstep(.02,.55,f2-f1);
 float g=pow(lane,.8)*(.62+.38*(1.-clamp(f1,0.,1.)))*(.86+.28*vn(p*3.1+t*.2));
 g*=1.-.55*smoothstep(.58,.9,pf)*exp(-f1*f1*16.);
 return g;
}
vec3 rx(vec3 v,float a){float c=cos(a),s=sin(a);return vec3(v.x,v.y*c-v.z*s,v.y*s+v.z*c);}
vec3 ry(vec3 v,float a){float c=cos(a),s=sin(a);return vec3(v.x*c+v.z*s,v.y,-v.x*s+v.z*c);}
void main(){
 vec2 uv=(2.*gl_FragCoord.xy-uRes)/uRes.y;
 vec2 q=uv*uHalf+uOff;
 float r=length(q),px=2.*uHalf/uRes.y;
 vec3 col=vec3(0);
 float t=uTime;
 vec3 base=lut(uTeff);
 vec3 hue=pow(base,vec3(10.));hue/=max(hue.r,max(hue.g,hue.b));
 vec3 mid=pow(hue,vec3(1.6)),hot=pow(hue,vec3(.35,.45,1.4));
 float edge=smoothstep(1.+px,1.-px,r);
 if(edge>0.){
  float z=sqrt(max(0.,1.-min(r*r,1.)));
  vec3 n=vec3(q,z);float mu=max(z,.02);
  vec3 s=ry(rx(n,uTilt),uRot);
  float foot=px*uFreq/max(mu,.15);
  float vis=1.-smoothstep(.2,.55,foot);
  float gran=.55;
  if(vis>.002&&uConv>.01&&uFilter<2.5){
   vec3 p=s*uFreq;
   vec3 w=vec3(vn(p*.35+t*.06),vn(p*.35+vec3(17.)-t*.05),vn(p*.35+vec3(31.)+t*.04))-.5;
   gran=boil(p+w*1.15,t);
  }
  float mf=uFreq*.2;
  float mvis=1.-smoothstep(.25,.7,px*mf/max(mu,.15));
  float meso=mvis>.002?fbm(s*mf+vec3(0.,t*.03,0.)):.5;
  float sup=ridged(s*max(uFreq/26.,2.2)+vec3(t*.012));
  float tf=1.,mp=0.,fac=0.,pl=0.;
  for(int i=0;i<uN;i++){
   vec4 c=uSpots[i];float d=dot(s,c.xyz);
   float reach=uFilter>2.5?max(c.w*4.2,.42):min(c.w*4.2,3.);
   if(d<cos(reach))continue;
   float a=acos(clamp(d,-1.,1.));
   vec3 t1=normalize(cross(c.xyz,vec3(.01,1.,.02))),t2=cross(c.xyz,t1),v=s-c.xyz*d;
   float th=atan(dot(v,t2),dot(v,t1));
   if(uFilter>2.5){float pr=c.w*5.+.05;float st=.62+.76*vn(vec3(cos(th)*17.,sin(th)*17.,a*26.+float(i)));pl=1.-(1.-pl)*(1.-clamp(.4*exp(-a*a/(pr*pr))*st,0.,1.));}
   float wob=.16*vn(vec3(cos(th)*3.+float(i)*4.,sin(th)*3.,1.));
   float x=a/c.w+wob-.08;
   float fil=vn(vec3(cos(th)*21.,sin(th)*21.,x*2.+float(i)));
   float mpn=1.-smoothstep(.86,1.06,x);
   float um=1.-smoothstep(.36,.46,x);
   float tt=mix(1.,1.-clamp(350.+.6*(uTeff-3300.),200.,2000.)/uTeff*(.36-.16*fil),mpn);tt=mix(tt,1.-clamp(350.+.6*(uTeff-3300.),200.,2000.)/uTeff,um);
   tf=min(tf,tt);mp=max(mp,mpn);
   fac=max(fac,exp(-pow(max(x-1.,0.)/1.25,2.)));
  }
  fac*=1.-mp;
  if(uFilter>2.5){
   float F=clamp(6.5/uHalf,5.,90.);
   vec3 sp=s*F+vec3(0.,t*.07,t*.03);
   vec3 wr=vec3(vn(sp*.8),vn(sp*.8+vec3(9.)),vn(sp*.8+vec3(21.)))-.5;
   float v1=fbm(sp+wr*2.2);
   float v2=ridged(sp*2.6+wr*3.4);
   float dk=1.-smoothstep(.34,.56,fbm(sp*1.35+wr*1.4+vec3(40.)));
   float v3=ridged(sp*7.+wr*5.);
   float v=.6*v1+.34*pow(v2,2.4)+.16*v3*v3-.3*dk;
   v=mix(.5,v,.15+.85*uConv)+uConv*pl*(.45+.9*v2);
   v*=mix(1.,.25,mp);
   col=mix(mid*.16+vec3(.012,.002,0.),mid*1.15,smoothstep(.12,.55,v));
   col=mix(col,hot*1.5,smoothstep(.55,.95,v));
   col=mix(col,vec3(2.2),smoothstep(1.05,1.6,v));
   col*=.82+.7*pow(1.-mu,2.4);
  }else if(uFilter<.5||uFilter>1.5){
   float conv=uConv*(1.-mp);
   float dT=conv*((gran-.5)*.24*vis+(meso-.5)*.07*mvis)+uConv*(sup-.55)*.02;
   dT+=fac*(.012+.05*pow(1.-mu,1.6));
   float tl=uTeff*tf*(1.+dT)*pow(.75*mu+.5,.25);
   float I=pow(tl/uTeff/1.0574,uBeta);
   col=lut(tl)*I*.64;
   if(uFilter>1.5){
    float L=dot(col,vec3(.2126,.7152,.0722));
    vec3 sat=pow(base,vec3(3.));sat/=max(sat.r,max(sat.g,sat.b));
    col=sat*smoothstep(0.,.95,L)*1.2+vec3(1.)*smoothstep(.74,1.15,L)*.42;
   }
  }else{
   float hf=clamp(uFreq*.2,16.,240.);
   vec3 sp=s*hf+vec3(0.,t*.05,0.);
   vec3 wr=vec3(fbm(sp*.7),fbm(sp*.7+9.),fbm(sp*.7+21.))-.5;
   float fib=ridged(sp+wr*2.6);
   float v=.20+.66*pow(fib,1.7)+.30*(sup-.5)+.1*(gran-.5)*vis*uConv;
   v+=fac*.42;v*=mix(1.,.2,mp);
   v=clamp(v,0.,1.35);
   col=mix(vec3(.16,.012,0.),vec3(1.05,.22,.015),smoothstep(.08,.62,v));
   col=mix(col,vec3(1.5,.92,.34),smoothstep(.62,1.12,v));
   col*=.86+.62*pow(1.-mu,2.2);
  }
  col*=edge;
 }
 if(r>1.-px){
  float h=max(r-1.,0.),out_=smoothstep(1.-px,1.+px,r);
  if(uFilter>2.5){
   float a=atan(q.x,q.y);
   float sh=.006+.012*vn(vec3(a*90.,t*.3,2.));
   col+=out_*mid*smoothstep(sh,0.,h)*.9;
   col+=out_*mid*(.3*exp(-h/.03)+.09*exp(-h/.11)+.018*exp(-h/.4));
  }else if(uFilter<.5||uFilter>1.5){
   vec3 gc=uFilter>1.5?pow(base,vec3(3.)):base;
   col+=out_*gc*(.34*exp(-h/.018)+.1*exp(-h/.09)+.025*exp(-h/.4));
  }else{
   float a=atan(q.x,q.y);
   float sh=.005+.013*vn(vec3(a*430.,t*.25,1.))*(.45+.9*vn(vec3(a*130.,t*.12,4.)));
   col+=out_*vec3(1.05,.26,.03)*smoothstep(sh,sh*.2,h);
   col+=out_*vec3(.8,.16,.03)*(.05*exp(-h/.04)+.006*exp(-h/.3));
  }
 }
 if(uFilter>.5&&(uFilter<1.5||uFilter>2.5))col=1.-exp(-col*1.25);
 col=pow(clamp(col,0.,1.),vec3(1./2.2));
 col+=(fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5)/255.;
 O=vec4(col,1.);
}`;

function StarGL(canvas) {
  var gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('no webgl2');
  function sh(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  var p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  gl.useProgram(p);
  gl.bindVertexArray(gl.createVertexArray());
  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, LUT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  var U = {};
  [
    'uRes',
    'uOff',
    'uTime',
    'uTeff',
    'uFreq',
    'uConv',
    'uHalf',
    'uRot',
    'uTilt',
    'uBeta',
    'uFilter',
    'uSpots',
    'uN',
    'uLut',
  ].forEach(function (n) {
    U[n] = gl.getUniformLocation(p, n);
  });
  gl.uniform1i(U.uLut, 0);
  var scale = 1,
    ema = 16,
    last = 0;
  this.draw = function (o) {
    var now = performance.now();
    if (last) {
      ema = ema * 0.92 + (now - last) * 0.08;
      if (!window.__sxPin && ema > 42 && scale > 0.42) {
        scale *= 0.93;
        ema = 30;
      } else if (!window.__sxPin && ema < 19 && scale < 1) {
        scale = Math.min(1, scale * 1.01);
      }
    }
    last = now;
    var w = Math.round(canvas.clientWidth * Math.min(devicePixelRatio || 1, 1.5) * scale),
      h = Math.round(canvas.clientHeight * Math.min(devicePixelRatio || 1, 1.5) * scale);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(U.uRes, w, h);
    gl.uniform2f(U.uOff, o.off[0], o.off[1]);
    gl.uniform1f(U.uTime, o.time);
    gl.uniform1f(U.uTeff, o.T);
    gl.uniform1f(U.uFreq, o.freq);
    gl.uniform1f(U.uConv, o.conv);
    gl.uniform1f(U.uHalf, o.half);
    gl.uniform1f(U.uRot, o.rot);
    gl.uniform1f(U.uTilt, o.tilt);
    gl.uniform1f(U.uBeta, clamp(26180 / o.T, 1, 9));
    gl.uniform1f(U.uFilter, o.filter);
    gl.uniform4fv(U.uSpots, o.spots);
    gl.uniform1i(U.uN, o.n);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

/* ---------- star model ---------- */
var PRESETS = [
  { id: 'rg', label: 'Red giant', T: 3050, R: 300, M: 1.0, P: 400, dwarf: false },
  { id: 'm', label: 'Red dwarf', T: 3200, R: 0.19, M: 0.16, P: 140, dwarf: true },
  { id: 'k', label: 'Orange dwarf', T: 4500, R: 0.72, M: 0.72, P: 30, dwarf: true },
  { id: 'g', label: 'Sun', T: 5772, R: 1, M: 1, P: 25.4, dwarf: true },
  { id: 'f', label: 'Yellow-white', T: 6500, R: 1.3, M: 1.25, P: 8, dwarf: true },
  { id: 'a', label: 'White star', T: 8500, R: 1.8, M: 2.0, P: 1.5, dwarf: true },
  { id: 'b', label: 'Blue star', T: 22000, R: 4.5, M: 9, P: 1.5, dwarf: true },
];
var ST = { p: PRESETS[3], view: 'big', filter: 3, P: 25.4, playing: !reduced, time: 3 };
var BIG = 30,
  FILTER_NAME = {
    0: 'True colour',
    1: 'Hydrogen-alpha',
    2: 'Enhanced colour',
    3: 'Observatory view',
  };
var ROT_MIN = Math.log(0.3),
  ROT_MAX = Math.log(600);
var B_SUN = 199 * Math.pow(25.4 / Math.pow(10, 1.16)*Math.pow(10,1.16)/12.3, -1.26),
  F_SUN = 0.0015,
  MEAN_A = 7.5e-5 * Math.exp(0.5);
function tauC(M) {
  var l = 0;return(12.3/Math.sqrt(M.R*M.R*Math.pow(M.T/5772,4)));
  return Math.pow(10, 1.16 - 1.49 * l - 0.54 * l * l);
}
function model() {
  var p = ST.p,
    conv = 1 - smooth(6500, 8200, p.T),
    g0 = (274 * p.M) / (p.R * p.R);
  var Hkm = (8254 * p.T) / (1.3 * g0) / 1000,
    L = 8 * Hkm,
    Rkm = p.R * 696000,
    cells = Rkm / L;
  var Ro = null,
    B = null,
    f = 0;
  if (p.dwarf && conv > 0.05) {
    Ro = ST.P / tauC(p);
    B = Ro < 0.13 ? 2050 * Math.pow(Ro, -0.11) : 199 * Math.pow(Ro, -1.26);
    f = Math.min(0.25, F_SUN * Math.pow(B / B_SUN, 1.6)) * conv;
  }
  var nReal = f / MEAN_A,
    nG = Math.min(12, Math.round(nReal)),
    k = nG ? f / (nG * MEAN_A) : 1;
  var r = rng(1729),
    sp = new Float32Array(48 * 4),
    n = 0,
    best = null,
    bestA = 0,
    groups = [];
  var latC = 15 + 45 * Math.min(1, f / 0.2);
  function box() {
    return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(6.2832 * r());
  }
  function put(lat, lon, area) {
    var th = Math.min(0.5, 2 * Math.sqrt(area));
    var c = Math.cos(lat);
    sp[n * 4] = c * Math.sin(lon);
    sp[n * 4 + 1] = Math.sin(lat);
    sp[n * 4 + 2] = c * Math.cos(lon);
    sp[n * 4 + 3] = th;
    n++;
    return th;
  }
  for (var i = 0; i < nG; i++) {
    r();
    var a = 7.5e-5 * Math.exp(box()) * k,
      hemi = i % 2 ? -1 : 1,
      la = ((latC + 6 * box()) * Math.PI) / 180,
      lon = i < 3 ? 0.2 + i * 1.1 - 1.1 : r() * 6.2832;
    la = clamp(la, (3 * Math.PI) / 180, 1.3);
    var tilt = (32 * Math.sin(la) * Math.PI) / 180,
      sep = 8 * Math.sqrt(a) + 0.015,
      lat = hemi * la;
    var dLat = (hemi * Math.sin(tilt) * sep) / 2,
      dLon = (Math.cos(tilt) * sep) / 2 / Math.cos(la);
    var i0 = n;
    put(lat - dLat, lon + dLon, a * 0.55);
    put(lat + dLat, lon - dLon, a * 0.3);
    var lv = [sp[i0 * 4], sp[i0 * 4 + 1], sp[i0 * 4 + 2]],
      fv = [sp[i0 * 4 + 4], sp[i0 * 4 + 5], sp[i0 * 4 + 6]];
    var cv = norm([lv[0] + fv[0], lv[1] + fv[1], lv[2] + fv[2]]),
      es = norm([lv[0] - fv[0], lv[1] - fv[1], lv[2] - fv[2]]);
    groups.push({
      c: cv,
      es: es,
      en: [
        cv[1] * es[2] - cv[2] * es[1],
        cv[2] * es[0] - cv[0] * es[2],
        cv[0] * es[1] - cv[1] * es[0],
      ],
      sep: Math.acos(clamp(lv[0] * fv[0] + lv[1] * fv[1] + lv[2] * fv[2], -1, 1)),
      area: a,
    });
    put(lat + dLat * 0.2 + 0.6 * sep * (r() - 0.5), lon - 0.4 * dLon, a * 0.075);
    put(lat - 0.5 * dLat + 0.6 * sep * (r() - 0.5), lon + 0.1 * dLon, a * 0.075);
    if (a > bestA) {
      bestA = a;
      best = [lat, lon];
    }
  }
  return {
    conv: conv,
    g: g0,
    Hkm: Hkm,
    L: L,
    cells: cells,
    Ro: Ro,
    B: B,
    f: f,
    nReal: nReal,
    nG: nG,
    sp: sp,
    n: n,
    best: best,
    groups: groups,
  };
}
function norm(v) {
  var l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
var MODEL = null;
function fmt(x, d) {
  return x.toLocaleString('en', { maximumFractionDigits: d == null ? 0 : d });
}
function readouts() {
  var p = ST.p,
    m = MODEL,
    c = planckRGB(p.T);
  var rows = [
    ['Surface temperature', fmt(p.T) + ' K'],
    [
      'Colour from the spectrum',
      '<span class="swatch" style="background:' + hex(c) + '"></span>' + hex(c),
    ],
    ['Brightest wavelength', fmt((2898 / p.T) * 1000) + ' nm'],
    ['Surface gravity', fmt(m.g, m.g < 1 ? 3 : 0) + ' m/s²'],
  ];
  if (m.conv > 0.05) {
    rows.push([
      'Size of one cell',
      m.L > 1e5 ? fmt(m.L / 1e6, 0) + ' million km' : fmt(m.L, 0) + ' km',
    ]);
    rows.push(['Cells per star radius', fmt(m.cells)]);
  } else rows.push(['Boiling cells', 'None: no outer convection']);
  if (m.Ro != null) {
    rows.push(['Rossby number', fmt(m.Ro, 2)]);
    rows.push(['Average magnetic field', fmt(m.B) + ' G']);
    rows.push(['Surface covered by spots', fmt(m.f * 100, 2) + '%']);
    rows.push([
      'Spot groups' + (m.nReal > 12 ? ' (12 largest drawn)' : ''),
      fmt(Math.round(m.nReal)),
    ]);
    var d = ((300 * F_SUN) / m.f) * 3;
    rows.push(['X10 flare, about every', d >= 2 ? fmt(d) + ' days' : fmt(d * 24, 0) + ' hours']);
  } else rows.push(['Magnetic field', p.dwarf ? 'No surface dynamo' : 'Fit covers dwarfs only']);
  $('#star-read').innerHTML = rows
    .map(function (r) {
      return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>';
    })
    .join('');
  var live = p.dwarf && m.conv > 0.05;
  $('#rot').disabled = !live;
  $('#rot-v').textContent = live
    ? (ST.P < 2 ? fmt(ST.P, 1) : fmt(ST.P)) + ' days'
    : 'not used for this star';
  $('#rot').value = Math.round(((Math.log(ST.P) - ROT_MIN) / (ROT_MAX - ROT_MIN)) * 1000);
}
function caption() {
  var m = MODEL,
    p = ST.p,
    t;
  if (m.conv < 0.05)
    t =
      'Stars this hot have almost no convection near the surface, so there are no boiling cells and no sunspots. The smooth look is the correct one.';
  else if (ST.view === 'true')
    t =
      m.cells > 150
        ? 'True scale. Real cells are smaller than a pixel at this distance, which is why a whole star looks smooth in visible light.'
        : 'True scale. Low gravity makes the cells enormous, so a giant shows only a handful at once.';
  else if (ST.view === 'big')
    t =
      m.cells > BIG
        ? 'Cells drawn ' +
          fmt(m.cells / BIG) +
          ' times larger than life so the boiling reads at this distance. The app would label this layer Default (artistic).'
        : 'Cells at true scale. Low gravity makes them this large.';
  else
    t =
      'Close-up at true scale, with contrast raised the way processed solar images are. One cell is about ' +
      (m.L > 1e5 ? fmt(m.L / 1e6) + ' million km' : fmt(m.L) + ' km') +
      ' across and lasts minutes on the Sun. Motion is sped up.';
  if (ST.filter === 3 && m.conv >= 0.05) t = '';
  if (ST.filter === 3)
    t +=
      ' False-colour extreme ultraviolet, the kind of view NASA’s SDO spacecraft shows. It reveals the hot atmosphere, so loops and flares stand out.';
  if (ST.filter === 2)
    t +=
      ' Enhanced colour deepens the star’s real hue so differences between stars are easy to see. The swatch on the right is its true colour.';
  if (ST.filter === 0 && m.groups.length)
    t +=
      ' Loops and most flares are too faint to see against the disc in true colour, so they are hidden here.';
  if (ST.filter !== 0 && ST.view !== 'close' && m.groups.length)
    t +=
      (ST.view === 'big'
        ? ' Loops are drawn 3 times larger so they read at this distance.'
        : ' Loops are at true scale.') +
      ' The flare schedule is sped up: one second is about 29 hours. Flare arches are turned by up to 75° so you see them side-on.';
  $('#star-cap').textContent = t.trim();
  $('#star-tag').textContent = p.label + ' · ' + FILTER_NAME[ST.filter];
}
function pills(host, items, cur, on) {
  host.innerHTML = '';
  items.forEach(function (it) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'b';
    b.textContent = it.label;
    b.dataset.id = it.id;
    b.setAttribute('aria-pressed', String(it.id === cur));
    b.addEventListener('click', function () {
      [].forEach.call(host.children, function (c) {
        c.setAttribute('aria-pressed', String(c === b));
      });
      on(it);
    });
    host.appendChild(b);
  });
}
var starGL = null,
  flareGL = null,
  starErr = false;
try {
  starGL = new StarGL($('#star-c'));
} catch (e) {
  starErr = true;
  console.error(e);
}
try {
  flareGL = new StarGL($('#flare-c'));
} catch (e) {
  console.error(e);
}
if (starErr) {
  var d = document.createElement('div');
  d.className = 'fail';
  d.textContent = 'This browser could not start WebGL 2, so the live star cannot be shown.';
  $('#star-stage').appendChild(d);
}
function drawStar() {
  if (!starGL) return;
  var m = MODEL,
    half = 1.28,
    off = [0, 0],
    rot = 0.55 + ST.time * 0.012,
    tilt = 0.12,
    freq = m.cells;
  if (ST.view === 'big') freq = Math.min(m.cells, BIG);
  if (ST.view === 'close') {
    half = Math.min(1.28, 15 / m.cells);
    var b = CLOSE_AT || m.best || [0.26, 0.5];
    var c = Math.cos(b[0]),
      L = [c * Math.sin(b[1]), Math.sin(b[0]), c * Math.cos(b[1])];
    tilt = -Math.asin(L[1]);
    rot = Math.atan2(L[0], L[2]);
  }
  starGL.draw({
    off: off,
    time: ST.time,
    T: ST.p.T,
    freq: freq,
    conv: m.conv,
    half: half,
    rot: rot,
    tilt: tilt,
    filter: ST.filter,
    spots: m.sp,
    n: m.n,
  });
  drawOverlay(rot, tilt, half);
}

// @end-verbatim
