var camera, scene, renderer;
var geometry, material, mesh;
var uniforms;
var mouseX, mouseY;
var presetCoords = [
  {x: '0.29942857142857133', y: '0.021000000000000018'},
];
var mouseCoords = new THREE.Vector2(presetCoords[0].x, presetCoords[0].y);

const renderElement = window.getComputedStyle(document.getElementById('code-demo'));
var width = parseInt(renderElement.width.replace('px', ''));
var height = parseInt(renderElement.height.replace('px', ''));
var aspect = width / height;
var zoom = 3.0;
var res = new THREE.Vector2(width, height);
var offset = new THREE.Vector2(-1.5*aspect, -1.5);
var mouse_down = false;
var need_update = false;
var need_scroll_update = false;

var colora = 0.3;
var colorb = 6.15;
var colorc = 1.85;
const primaryColor = 0xDDDDDD;

var perfTheme = localStorage.getItem('pref-theme');
var isDark = (perfTheme && perfTheme === 'light') ? false : true;

init();
need_update = true;
animate();
// ===============================================

function init() {
  setup();
  uniforms = {
    res: {type: 'vec2', value: new THREE.Vector2(width, height)},
    aspect: {type: 'float', value: aspect},
    zoom: {type:'float', value: zoom},
    offset: {type:'vec2', value: offset},
    c: {type:'vec3', value: new THREE.Vector2(-0.777, -0.239)},
    colora: {type: 'float', value: colora },
    colorb: {type: 'float', value: colorb },
    colorc: {type: 'float', value: colorc },
    dark:   {type: 'bool', value: isDark },
  };
  geometry = new THREE.PlaneBufferGeometry(2, 2);
  material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    fragmentShader: fragmentShader(),
  });
  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  animate();
}

function animate(){
  if (need_update){
    uniforms["c"]["value"] = mouseCoords;
    need_update = false;
  }
  if (need_scroll_update){
    uniforms["zoom"]["value"] = zoom;
    uniforms["offset"]["value"] = offset;
    need_scroll_update = false;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// shader ===========================================
function fragmentShader(){
  return `
precision highp float;
uniform vec2 res;
uniform float aspect;
uniform float zoom;
uniform vec2 offset;
uniform float colora;
uniform float colorb;
uniform float colorc;
uniform bool dark;

// gui parameters
uniform vec2 c;

vec2 cm (vec2 a, vec2 b){
  return vec2(a.x*b.x - a.y*b.y, a.x*b.y + b.x*a.y);
}

vec2 conj (vec2 a){
  return vec2(a.x, -a.y);
}

float julia(vec2 z, vec2 c){
  float alpha = 1.0;
  vec2 z_n;
  vec2 z_n_1;

  for(int i=0; i < 150; i++){  // i < max iterations
    z_n_1 = z_n;
    z_n = z;

    float x_n_sq = z_n.x*z_n.x;
    float y_n_sq = z_n.y*z_n.y;
    vec2 z_n_sq = vec2(x_n_sq - y_n_sq, 2.0*z_n.x*z_n.y);

    // the recurrence equation
    z = z_n_sq + c;


    float z_mag = z.x*z.x + z.y*z.y;
    float z_n_mag = x_n_sq + y_n_sq;

    if(z_mag > 8.0){
      float frac = (4.0 - z_n_mag) / (z_mag - z_n_mag);
      alpha = (float(i) + frac)/150.0; // should be same as max iterations
      break;
    }
  }
  return alpha;
}

void main(){ // gl_FragCoord in [0,1]
  float factor, s2, s3;
  vec2 uv = zoom * vec2(aspect, 1.0) * gl_FragCoord.xy / res + offset;
  if (dark) {
    // Black coords
    factor = 0.1150;
    s2 = 0.001;
    s3 = 0.01109;
  } else {
    // White coords
    factor = 0.9599;
    s2 = 0.0;
    s3 = 0.0;
  }
  float s = abs(factor - julia(uv, c));
  vec3 coord = vec3(s, s+s2, s+s3);
  vec3 res = pow(coord, vec3(colora, colorb, colorc));
  gl_FragColor = vec4(coord, 1);
}`
}

// Setup ================================================
function setup(){
  camera = new THREE.OrthographicCamera( -1, 1, 1, -1, -1, 1);

  scene = new THREE.Scene();
  const color2 = new THREE.Color( primaryColor );
  scene.background = color2;

  renderer = new THREE.WebGLRenderer( { antialias: true, precision:'highp' } );
  renderer.setSize( width, height-2 );
  const rendererDOM = renderer.domElement;
  rendererDOM.setAttribute('id', 'frontpage-demo');
  document.getElementById('code-demo').appendChild( rendererDOM );
}

// events ================================================
// window.addEventListener('resize', windowResize, false);
// document.addEventListener('wheel', scroll);
const codeDemo = document.getElementById('code-demo');
codeDemo.addEventListener( 'mousedown', mouseDown, false );
codeDemo.addEventListener( 'touchstart', touchStart, false );
codeDemo.addEventListener( 'mousemove', onMove, false );
codeDemo.addEventListener( 'touchmove', onTouchMove, false );
codeDemo.addEventListener( 'touchend', mouseUp, false );
codeDemo.addEventListener( 'mouseup', mouseUp, false );

function windowResize() {  //aspect intentionaly not updated
  width = window.innerWidth;
  height = window.innerHeight;
  aspect = width/height;
  camera.aspect =  aspect;
  camera.updateProjectionMatrix();
  renderer.setSize( width, height-2);
}

function scroll(event) {
  let zoom_0 = zoom;
  if ("wheelDeltaY" in event){  // chrome vs. firefox
    zoom *= 1 - event.wheelDeltaY*0.0003;
  } else{
    zoom *= 1 + event.deltaY*0.01;
  }

  let space = zoom - zoom_0;
  let x_ = event.clientX / width;
  let y_ = 1-event.clientY / height;
  offset = offset.add(new THREE.Vector2(-x_*space*aspect, -y_*space));
  need_scroll_update = true;
}

function setMouseCoords(event) {
  var clientX, clientY;
  if (event.changedTouches) {
    clientX = event.changedTouches[0].clientX;
    clientY = event.changedTouches[0].clientY;
  } else {
    clientX = event.clientX;
    clientY = event.clientY;
  }
  mouseX = zoom*aspect*clientX / width + offset.x;
  mouseY = zoom*clientY / height + offset.y;
  mouseCoords = new THREE.Vector2(mouseX, mouseY);
}

function touchStart(){
  mouse_down = true;
  need_update = true;
}

function mouseDown(){
  mouse_down = true;
  need_update = true;
}

function onMove(event){
  setMouseCoords(event)
  if (mouse_down){
    need_update = true;
  }
}

function onTouchMove(event) {
  onMove(event);
  event.preventDefault();
}

function mouseUp(){
  mouse_down = false;
}
