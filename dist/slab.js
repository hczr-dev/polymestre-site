import{A as Rn,Aa as Se,B as Mn,Ba as uo,C as Ne,D as Lo,E as no,F as Sn,G as dt,H as Ct,I as An,J as z,L as _t,M as ue,O as ro,P as Y,Q as Io,R as Fe,S as D,T as Qe,U as ht,V as kt,X as zo,Y as so,_ as Hn,a as hn,aa as Cn,b as mn,ba as mt,c as pn,ca as _n,d as Ze,da as kn,e as gn,ea as io,f as vn,g as bn,ga as ao,h as wn,ha as Pn,i as oo,ia as Go,j as xn,ja as Bn,k as En,ka as Ln,la as lo,m as yn,ma as No,na as co,oa as In,pa as fo,q as Ht,qa as zn,ra as Me,sa as pt,ta as Gn,ua as Fo,va as Nn,wa as Do,x as Tn,xa as Uo,y as Bo,ya as Fn,z as Re,za as Pt}from"./chunk-2NC3QT7D.js";var Bt=class t extends D{constructor(){let e=t.SkyShader,o=new kt({name:e.name,uniforms:ht.clone(e.uniforms),vertexShader:e.vertexShader,fragmentShader:e.fragmentShader,side:pn,depthWrite:!1});super(new Qe(1,1,1),o),this.isSky=!0}};Bt.SkyShader={name:"SkyShader",uniforms:{turbidity:{value:2},rayleigh:{value:1},mieCoefficient:{value:.005},mieDirectionalG:{value:.8},sunPosition:{value:new z},up:{value:new z(0,1,0)}},vertexShader:`
		uniform vec3 sunPosition;
		uniform float rayleigh;
		uniform float turbidity;
		uniform float mieCoefficient;
		uniform vec3 up;

		varying vec3 vWorldPosition;
		varying vec3 vSunDirection;
		varying float vSunfade;
		varying vec3 vBetaR;
		varying vec3 vBetaM;
		varying float vSunE;

		// constants for atmospheric scattering
		const float e = 2.71828182845904523536028747135266249775724709369995957;
		const float pi = 3.141592653589793238462643383279502884197169;

		// wavelength of used primaries, according to preetham
		const vec3 lambda = vec3( 680E-9, 550E-9, 450E-9 );
		// this pre-calcuation replaces older TotalRayleigh(vec3 lambda) function:
		// (8.0 * pow(pi, 3.0) * pow(pow(n, 2.0) - 1.0, 2.0) * (6.0 + 3.0 * pn)) / (3.0 * N * pow(lambda, vec3(4.0)) * (6.0 - 7.0 * pn))
		const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );

		// mie stuff
		// K coefficient for the primaries
		const float v = 4.0;
		const vec3 K = vec3( 0.686, 0.678, 0.666 );
		// MieConst = pi * pow( ( 2.0 * pi ) / lambda, vec3( v - 2.0 ) ) * K
		const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );

		// earth shadow hack
		// cutoffAngle = pi / 1.95;
		const float cutoffAngle = 1.6110731556870734;
		const float steepness = 1.5;
		const float EE = 1000.0;

		float sunIntensity( float zenithAngleCos ) {
			zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );
			return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );
		}

		vec3 totalMie( float T ) {
			float c = ( 0.2 * T ) * 10E-18;
			return 0.434 * c * MieConst;
		}

		void main() {

			vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
			vWorldPosition = worldPosition.xyz;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			gl_Position.z = gl_Position.w; // set z to camera.far

			vSunDirection = normalize( sunPosition );

			vSunE = sunIntensity( dot( vSunDirection, up ) );

			vSunfade = 1.0 - clamp( 1.0 - exp( ( sunPosition.y / 450000.0 ) ), 0.0, 1.0 );

			float rayleighCoefficient = rayleigh - ( 1.0 * ( 1.0 - vSunfade ) );

			// extinction (absorbtion + out scattering)
			// rayleigh coefficients
			vBetaR = totalRayleigh * rayleighCoefficient;

			// mie coefficients
			vBetaM = totalMie( turbidity ) * mieCoefficient;

		}`,fragmentShader:`
		varying vec3 vWorldPosition;
		varying vec3 vSunDirection;
		varying float vSunfade;
		varying vec3 vBetaR;
		varying vec3 vBetaM;
		varying float vSunE;

		uniform float mieDirectionalG;
		uniform vec3 up;

		// constants for atmospheric scattering
		const float pi = 3.141592653589793238462643383279502884197169;

		const float n = 1.0003; // refractive index of air
		const float N = 2.545E25; // number of molecules per unit volume for air at 288.15K and 1013mb (sea level -45 celsius)

		// optical length at zenith for molecules
		const float rayleighZenithLength = 8.4E3;
		const float mieZenithLength = 1.25E3;
		// 66 arc seconds -> degrees, and the cosine of that
		const float sunAngularDiameterCos = 0.999956676946448443553574619906976478926848692873900859324;

		// 3.0 / ( 16.0 * pi )
		const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
		// 1.0 / ( 4.0 * pi )
		const float ONE_OVER_FOURPI = 0.07957747154594767;

		float rayleighPhase( float cosTheta ) {
			return THREE_OVER_SIXTEENPI * ( 1.0 + pow( cosTheta, 2.0 ) );
		}

		float hgPhase( float cosTheta, float g ) {
			float g2 = pow( g, 2.0 );
			float inverse = 1.0 / pow( 1.0 - 2.0 * g * cosTheta + g2, 1.5 );
			return ONE_OVER_FOURPI * ( ( 1.0 - g2 ) * inverse );
		}

		void main() {

			vec3 direction = normalize( vWorldPosition - cameraPosition );

			// optical length
			// cutoff angle at 90 to avoid singularity in next formula.
			float zenithAngle = acos( max( 0.0, dot( up, direction ) ) );
			float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );
			float sR = rayleighZenithLength * inverse;
			float sM = mieZenithLength * inverse;

			// combined extinction factor
			vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );

			// in scattering
			float cosTheta = dot( direction, vSunDirection );

			float rPhase = rayleighPhase( cosTheta * 0.5 + 0.5 );
			vec3 betaRTheta = vBetaR * rPhase;

			float mPhase = hgPhase( cosTheta, mieDirectionalG );
			vec3 betaMTheta = vBetaM * mPhase;

			vec3 Lin = pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
			Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 1.0 / 2.0 ) ), clamp( pow( 1.0 - dot( up, vSunDirection ), 5.0 ), 0.0, 1.0 ) );

			// nightsky
			float theta = acos( direction.y ); // elevation --> y-axis, [-pi/2, pi/2]
			float phi = atan( direction.z, direction.x ); // azimuth --> x-axis [-pi/2, pi/2]
			vec2 uv = vec2( phi, theta ) / vec2( 2.0 * pi, pi ) + vec2( 0.5, 0.0 );
			vec3 L0 = vec3( 0.1 ) * Fex;

			// composition + solar disc
			float sundisk = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta );
			L0 += ( vSunE * 19000.0 * Fex ) * sundisk;

			vec3 texColor = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );

			vec3 retColor = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) );

			gl_FragColor = vec4( retColor, 1.0 );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>

		}`};var Lt=new z;function de(t,e,o,n,r,s){let i=2*Math.PI*r/4,c=Math.max(s-2*r,0),a=Math.PI/4;Lt.copy(e),Lt[n]=0,Lt.normalize();let f=.5*i/(i+c),l=1-Lt.angleTo(t)/a;return Math.sign(Lt[o])===1?l*f:c/(i+c)+f+f*(1-l)}var ho=class extends Qe{constructor(e=1,o=1,n=1,r=2,s=.1){if(r=r*2+1,s=Math.min(e/2,o/2,n/2,s),super(1,1,1,r,r,r),r===1)return;let i=this.toNonIndexed();this.index=null,this.attributes.position=i.attributes.position,this.attributes.normal=i.attributes.normal,this.attributes.uv=i.attributes.uv;let c=new z,a=new z,f=new z(e,o,n).divideScalar(2).subScalar(s),l=this.attributes.position.array,u=this.attributes.normal.array,d=this.attributes.uv.array,m=l.length/6,h=new z,p=.5/r;for(let v=0,w=0;v<l.length;v+=3,w+=2)switch(c.fromArray(l,v),a.copy(c),a.x-=Math.sign(a.x)*p,a.y-=Math.sign(a.y)*p,a.z-=Math.sign(a.z)*p,a.normalize(),l[v+0]=f.x*Math.sign(c.x)+a.x*s,l[v+1]=f.y*Math.sign(c.y)+a.y*s,l[v+2]=f.z*Math.sign(c.z)+a.z*s,u[v+0]=a.x,u[v+1]=a.y,u[v+2]=a.z,Math.floor(v/m)){case 0:h.set(1,0,0),d[w+0]=de(h,a,"z","y",s,n),d[w+1]=1-de(h,a,"y","z",s,o);break;case 1:h.set(-1,0,0),d[w+0]=1-de(h,a,"z","y",s,n),d[w+1]=1-de(h,a,"y","z",s,o);break;case 2:h.set(0,1,0),d[w+0]=1-de(h,a,"x","z",s,e),d[w+1]=de(h,a,"z","x",s,n);break;case 3:h.set(0,-1,0),d[w+0]=1-de(h,a,"x","z",s,e),d[w+1]=1-de(h,a,"z","x",s,n);break;case 4:h.set(0,0,1),d[w+0]=1-de(h,a,"x","y",s,e),d[w+1]=1-de(h,a,"y","x",s,o);break;case 5:h.set(0,0,-1),d[w+0]=de(h,a,"x","y",s,e),d[w+1]=1-de(h,a,"y","x",s,o);break}}};var Oo=new WeakMap,mo=class extends Gn{constructor(e){super(e),this.decoderPath="",this.decoderConfig={},this.decoderBinary=null,this.decoderPending=null,this.workerLimit=4,this.workerPool=[],this.workerNextTaskID=1,this.workerSourceURL="",this.defaultAttributeIDs={position:"POSITION",normal:"NORMAL",color:"COLOR",uv:"TEX_COORD"},this.defaultAttributeTypes={position:"Float32Array",normal:"Float32Array",color:"Float32Array",uv:"Float32Array"}}setDecoderPath(e){return this.decoderPath=e,this}setDecoderConfig(e){return this.decoderConfig=e,this}setWorkerLimit(e){return this.workerLimit=e,this}load(e,o,n,r){let s=new Fo(this.manager);s.setPath(this.path),s.setResponseType("arraybuffer"),s.setRequestHeader(this.requestHeader),s.setWithCredentials(this.withCredentials),s.load(e,i=>{this.parse(i,o,r)},n,r)}parse(e,o,n=()=>{}){this.decodeDracoFile(e,o,null,null,Re,n).catch(n)}decodeDracoFile(e,o,n,r,s=Rn,i=()=>{}){let c={attributeIDs:n||this.defaultAttributeIDs,attributeTypes:r||this.defaultAttributeTypes,useUniqueIDs:!!n,vertexColorSpace:s};return this.decodeGeometry(e,c).then(o).catch(i)}decodeGeometry(e,o){let n=JSON.stringify(o);if(Oo.has(e)){let a=Oo.get(e);if(a.key===n)return a.promise;if(e.byteLength===0)throw new Error("THREE.DRACOLoader: Unable to re-decode a buffer with different settings. Buffer has already been transferred.")}let r,s=this.workerNextTaskID++,i=e.byteLength,c=this._getWorker(s,i).then(a=>(r=a,new Promise((f,l)=>{r._callbacks[s]={resolve:f,reject:l},r.postMessage({type:"decode",id:s,taskConfig:o,buffer:e},[e])}))).then(a=>this._createGeometry(a.geometry));return c.catch(()=>!0).then(()=>{r&&s&&this._releaseTask(r,s)}),Oo.set(e,{key:n,promise:c}),c}_createGeometry(e){let o=new Fe;e.index&&o.setIndex(new Y(e.index.array,1));for(let n=0;n<e.attributes.length;n++){let r=e.attributes[n],s=r.name,i=r.array,c=r.itemSize,a=new Y(i,c);s==="color"&&(this._assignVertexColorSpace(a,r.vertexColorSpace),a.normalized=!(i instanceof Float32Array)),o.setAttribute(s,a)}return o}_assignVertexColorSpace(e,o){if(o!==Re)return;let n=new ue;for(let r=0,s=e.count;r<s;r++)n.fromBufferAttribute(e,r),no.toWorkingColorSpace(n,Re),e.setXYZ(r,n.r,n.g,n.b)}_loadLibrary(e,o){let n=new Fo(this.manager);return n.setPath(this.decoderPath),n.setResponseType(o),n.setWithCredentials(this.withCredentials),new Promise((r,s)=>{n.load(e,r,void 0,s)})}preload(){return this._initDecoder(),this}_initDecoder(){if(this.decoderPending)return this.decoderPending;let e=typeof WebAssembly!="object"||this.decoderConfig.type==="js",o=[];return e?o.push(this._loadLibrary("draco_decoder.js","text")):(o.push(this._loadLibrary("draco_wasm_wrapper.js","text")),o.push(this._loadLibrary("draco_decoder.wasm","arraybuffer"))),this.decoderPending=Promise.all(o).then(n=>{let r=n[0];e||(this.decoderConfig.wasmBinary=n[1]);let s=Ir.toString(),i=["/* draco decoder */",r,"","/* worker */",s.substring(s.indexOf("{")+1,s.lastIndexOf("}"))].join(`
`);this.workerSourceURL=URL.createObjectURL(new Blob([i]))}),this.decoderPending}_getWorker(e,o){return this._initDecoder().then(()=>{if(this.workerPool.length<this.workerLimit){let r=new Worker(this.workerSourceURL);r._callbacks={},r._taskCosts={},r._taskLoad=0,r.postMessage({type:"init",decoderConfig:this.decoderConfig}),r.onmessage=function(s){let i=s.data;switch(i.type){case"decode":r._callbacks[i.id].resolve(i);break;case"error":r._callbacks[i.id].reject(i);break;default:console.error('THREE.DRACOLoader: Unexpected message, "'+i.type+'"')}},this.workerPool.push(r)}else this.workerPool.sort(function(r,s){return r._taskLoad>s._taskLoad?-1:1});let n=this.workerPool[this.workerPool.length-1];return n._taskCosts[e]=o,n._taskLoad+=o,n})}_releaseTask(e,o){e._taskLoad-=e._taskCosts[o],delete e._callbacks[o],delete e._taskCosts[o]}debug(){console.log("Task load: ",this.workerPool.map(e=>e._taskLoad))}dispose(){for(let e=0;e<this.workerPool.length;++e)this.workerPool[e].terminate();return this.workerPool.length=0,this.workerSourceURL!==""&&URL.revokeObjectURL(this.workerSourceURL),this}};function Ir(){let t,e;onmessage=function(i){let c=i.data;switch(c.type){case"init":t=c.decoderConfig,e=new Promise(function(l){t.onModuleLoaded=function(u){l({draco:u})},DracoDecoderModule(t)});break;case"decode":let a=c.buffer,f=c.taskConfig;e.then(l=>{let u=l.draco,d=new u.Decoder;try{let m=o(u,d,new Int8Array(a),f),h=m.attributes.map(p=>p.array.buffer);m.index&&h.push(m.index.array.buffer),self.postMessage({type:"decode",id:c.id,geometry:m},h)}catch(m){console.error(m),self.postMessage({type:"error",id:c.id,error:m.message})}finally{u.destroy(d)}});break}};function o(i,c,a,f){let l=f.attributeIDs,u=f.attributeTypes,d,m,h=c.GetEncodedGeometryType(a);if(h===i.TRIANGULAR_MESH)d=new i.Mesh,m=c.DecodeArrayToMesh(a,a.byteLength,d);else if(h===i.POINT_CLOUD)d=new i.PointCloud,m=c.DecodeArrayToPointCloud(a,a.byteLength,d);else throw new Error("THREE.DRACOLoader: Unexpected geometry type.");if(!m.ok()||d.ptr===0)throw new Error("THREE.DRACOLoader: Decoding failed: "+m.error_msg());let p={index:null,attributes:[]};for(let v in l){let w=self[u[v]],b,g;if(f.useUniqueIDs)g=l[v],b=c.GetAttributeByUniqueId(d,g);else{if(g=c.GetAttributeId(d,i[l[v]]),g===-1)continue;b=c.GetAttribute(d,g)}let R=r(i,c,d,v,w,b);v==="color"&&(R.vertexColorSpace=f.vertexColorSpace),p.attributes.push(R)}return h===i.TRIANGULAR_MESH&&(p.index=n(i,c,d)),i.destroy(d),p}function n(i,c,a){let l=a.num_faces()*3,u=l*4,d=i._malloc(u);c.GetTrianglesUInt32Array(a,u,d);let m=new Uint32Array(i.HEAPF32.buffer,d,l).slice();return i._free(d),{array:m,itemSize:1}}function r(i,c,a,f,l,u){let d=u.num_components(),h=a.num_points()*d,p=h*l.BYTES_PER_ELEMENT,v=s(i,l),w=i._malloc(p);c.GetAttributeDataArrayForAllPoints(a,u,v,p,w);let b=new l(i.HEAPF32.buffer,w,h).slice();return i._free(w),{name:f,array:b,itemSize:d}}function s(i,c){switch(c){case Float32Array:return i.DT_FLOAT32;case Int8Array:return i.DT_INT8;case Int16Array:return i.DT_INT16;case Int32Array:return i.DT_INT32;case Uint8Array:return i.DT_UINT8;case Uint16Array:return i.DT_UINT16;case Uint32Array:return i.DT_UINT32}}}function Wo(t,e=!1){let o=t[0].index!==null,n=new Set(Object.keys(t[0].attributes)),r=new Set(Object.keys(t[0].morphAttributes)),s={},i={},c=t[0].morphTargetsRelative,a=new Fe,f=0;for(let l=0;l<t.length;++l){let u=t[l],d=0;if(o!==(u.index!==null))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+l+". All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them."),null;for(let m in u.attributes){if(!n.has(m))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+l+'. All geometries must have compatible attributes; make sure "'+m+'" attribute exists among all geometries, or in none of them.'),null;s[m]===void 0&&(s[m]=[]),s[m].push(u.attributes[m]),d++}if(d!==n.size)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+l+". Make sure all geometries have the same number of attributes."),null;if(c!==u.morphTargetsRelative)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+l+". .morphTargetsRelative must be consistent throughout all geometries."),null;for(let m in u.morphAttributes){if(!r.has(m))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+l+".  .morphAttributes must be consistent throughout all geometries."),null;i[m]===void 0&&(i[m]=[]),i[m].push(u.morphAttributes[m])}if(e){let m;if(o)m=u.index.count;else if(u.attributes.position!==void 0)m=u.attributes.position.count;else return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+l+". The geometry must have either an index or a position attribute"),null;a.addGroup(f,m,l),f+=m}}if(o){let l=0,u=[];for(let d=0;d<t.length;++d){let m=t[d].index;for(let h=0;h<m.count;++h)u.push(m.getX(h)+l);l+=t[d].attributes.position.count}a.setIndex(u)}for(let l in s){let u=Dn(s[l]);if(!u)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the "+l+" attribute."),null;a.setAttribute(l,u)}for(let l in i){let u=i[l][0].length;if(u===0)break;a.morphAttributes=a.morphAttributes||{},a.morphAttributes[l]=[];for(let d=0;d<u;++d){let m=[];for(let p=0;p<i[l].length;++p)m.push(i[l][p][d]);let h=Dn(m);if(!h)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the "+l+" morphAttribute."),null;a.morphAttributes[l].push(h)}}return a}function Dn(t){let e,o,n,r=-1,s=0;for(let f=0;f<t.length;++f){let l=t[f];if(e===void 0&&(e=l.array.constructor),e!==l.array.constructor)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.array must be of consistent array types across matching attributes."),null;if(o===void 0&&(o=l.itemSize),o!==l.itemSize)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.itemSize must be consistent across matching attributes."),null;if(n===void 0&&(n=l.normalized),n!==l.normalized)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.normalized must be consistent across matching attributes."),null;if(r===-1&&(r=l.gpuType),r!==l.gpuType)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.gpuType must be consistent across matching attributes."),null;s+=l.count*o}let i=new e(s),c=new Y(i,o,n),a=0;for(let f=0;f<t.length;++f){let l=t[f];if(l.isInterleavedBufferAttribute){let u=a/o;for(let d=0,m=l.count;d<m;d++)for(let h=0;h<o;h++){let p=l.getComponent(d,h);c.setComponent(d+u,h,p)}}else i.set(l.array,a);a+=l.count*o}return r!==void 0&&(c.gpuType=r),c}function Un(t,e=1e-4){e=Math.max(e,Number.EPSILON);let o={},n=t.getIndex(),r=t.getAttribute("position"),s=n?n.count:r.count,i=0,c=Object.keys(t.attributes),a={},f={},l=[],u=["getX","getY","getZ","getW"],d=["setX","setY","setZ","setW"];for(let b=0,g=c.length;b<g;b++){let R=c[b],T=t.attributes[R];a[R]=new T.constructor(new T.array.constructor(T.count*T.itemSize),T.itemSize,T.normalized);let Ie=t.morphAttributes[R];Ie&&(f[R]||(f[R]=[]),Ie.forEach((J,se)=>{let ie=new J.array.constructor(J.count*J.itemSize);f[R][se]=new J.constructor(ie,J.itemSize,J.normalized)}))}let m=e*.5,h=Math.log10(1/e),p=Math.pow(10,h),v=m*p;for(let b=0;b<s;b++){let g=n?n.getX(b):b,R="";for(let T=0,Ie=c.length;T<Ie;T++){let J=c[T],se=t.getAttribute(J),ie=se.itemSize;for(let Te=0;Te<ie;Te++)R+=`${~~(se[u[Te]](g)*p+v)},`}if(R in o)l.push(o[R]);else{for(let T=0,Ie=c.length;T<Ie;T++){let J=c[T],se=t.getAttribute(J),ie=t.morphAttributes[J],Te=se.itemSize,St=a[J],qe=f[J];for(let Ke=0;Ke<Te;Ke++){let ct=u[Ke],ft=d[Ke];if(St[ft](i,se[ct](g)),ie)for(let ut=0,ko=ie.length;ut<ko;ut++)qe[ut][ft](i,ie[ut][ct](g))}}o[R]=i,l.push(i),i++}}let w=t.clone();for(let b in t.attributes){let g=a[b];if(w.setAttribute(b,new g.constructor(g.array.slice(0,i*g.itemSize),g.itemSize,g.normalized)),b in f)for(let R=0;R<f[b].length;R++){let T=f[b][R];w.morphAttributes[b][R]=new T.constructor(T.array.slice(0,i*T.itemSize),T.itemSize,T.normalized)}}return w.setIndex(l),w}var On={name:"CopyShader",uniforms:{tDiffuse:{value:null},opacity:{value:1}},vertexShader:`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		uniform float opacity;

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );
			gl_FragColor = opacity * texel;


		}`};var po=class extends Se{constructor(e,o){super(),this.textureID=o!==void 0?o:"tDiffuse",e instanceof kt?(this.uniforms=e.uniforms,this.material=e):e&&(this.uniforms=ht.clone(e.uniforms),this.material=new kt({name:e.name!==void 0?e.name:"unspecified",defines:Object.assign({},e.defines),uniforms:this.uniforms,vertexShader:e.vertexShader,fragmentShader:e.fragmentShader})),this.fsQuad=new uo(this.material)}render(e,o,n){this.uniforms[this.textureID]&&(this.uniforms[this.textureID].value=n.texture),this.fsQuad.material=this.material,this.renderToScreen?(e.setRenderTarget(null),this.fsQuad.render(e)):(e.setRenderTarget(o),this.clear&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),this.fsQuad.render(e))}dispose(){this.material.dispose(),this.fsQuad.dispose()}};var It=class extends Se{constructor(e,o){super(),this.scene=e,this.camera=o,this.clear=!0,this.needsSwap=!1,this.inverse=!1}render(e,o,n){let r=e.getContext(),s=e.state;s.buffers.color.setMask(!1),s.buffers.depth.setMask(!1),s.buffers.color.setLocked(!0),s.buffers.depth.setLocked(!0);let i,c;this.inverse?(i=0,c=1):(i=1,c=0),s.buffers.stencil.setTest(!0),s.buffers.stencil.setOp(r.REPLACE,r.REPLACE,r.REPLACE),s.buffers.stencil.setFunc(r.ALWAYS,i,4294967295),s.buffers.stencil.setClear(c),s.buffers.stencil.setLocked(!0),e.setRenderTarget(n),this.clear&&e.clear(),e.render(this.scene,this.camera),e.setRenderTarget(o),this.clear&&e.clear(),e.render(this.scene,this.camera),s.buffers.color.setLocked(!1),s.buffers.depth.setLocked(!1),s.buffers.color.setMask(!0),s.buffers.depth.setMask(!0),s.buffers.stencil.setLocked(!1),s.buffers.stencil.setFunc(r.EQUAL,1,4294967295),s.buffers.stencil.setOp(r.KEEP,r.KEEP,r.KEEP),s.buffers.stencil.setLocked(!0)}},go=class extends Se{constructor(){super(),this.needsSwap=!1}render(e){e.state.buffers.stencil.setLocked(!1),e.state.buffers.stencil.setTest(!1)}};var zt=class{constructor(e,o){if(this.renderer=e,this._pixelRatio=e.getPixelRatio(),o===void 0){let n=e.getSize(new Lo);this._width=n.width,this._height=n.height,o=new Ct(this._width*this._pixelRatio,this._height*this._pixelRatio,{type:Ht}),o.texture.name="EffectComposer.rt1"}else this._width=o.width,this._height=o.height;this.renderTarget1=o,this.renderTarget2=o.clone(),this.renderTarget2.texture.name="EffectComposer.rt2",this.writeBuffer=this.renderTarget1,this.readBuffer=this.renderTarget2,this.renderToScreen=!0,this.passes=[],this.copyPass=new po(On),this.copyPass.material.blending=gn,this.clock=new Pt}swapBuffers(){let e=this.readBuffer;this.readBuffer=this.writeBuffer,this.writeBuffer=e}addPass(e){this.passes.push(e),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}insertPass(e,o){this.passes.splice(o,0,e),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}removePass(e){let o=this.passes.indexOf(e);o!==-1&&this.passes.splice(o,1)}isLastEnabledPass(e){for(let o=e+1;o<this.passes.length;o++)if(this.passes[o].enabled)return!1;return!0}render(e){e===void 0&&(e=this.clock.getDelta());let o=this.renderer.getRenderTarget(),n=!1;for(let r=0,s=this.passes.length;r<s;r++){let i=this.passes[r];if(i.enabled!==!1){if(i.renderToScreen=this.renderToScreen&&this.isLastEnabledPass(r),i.render(this.renderer,this.writeBuffer,this.readBuffer,e,n),i.needsSwap){if(n){let c=this.renderer.getContext(),a=this.renderer.state.buffers.stencil;a.setFunc(c.NOTEQUAL,1,4294967295),this.copyPass.render(this.renderer,this.writeBuffer,this.readBuffer,e),a.setFunc(c.EQUAL,1,4294967295)}this.swapBuffers()}It!==void 0&&(i instanceof It?n=!0:i instanceof go&&(n=!1))}}this.renderer.setRenderTarget(o)}reset(e){if(e===void 0){let o=this.renderer.getSize(new Lo);this._pixelRatio=this.renderer.getPixelRatio(),this._width=o.width,this._height=o.height,e=this.renderTarget1.clone(),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}this.renderTarget1.dispose(),this.renderTarget2.dispose(),this.renderTarget1=e,this.renderTarget2=e.clone(),this.writeBuffer=this.renderTarget1,this.readBuffer=this.renderTarget2}setSize(e,o){this._width=e,this._height=o;let n=this._width*this._pixelRatio,r=this._height*this._pixelRatio;this.renderTarget1.setSize(n,r),this.renderTarget2.setSize(n,r);for(let s=0;s<this.passes.length;s++)this.passes[s].setSize(n,r)}setPixelRatio(e){this._pixelRatio=e,this.setSize(this._width,this._height)}dispose(){this.renderTarget1.dispose(),this.renderTarget2.dispose(),this.copyPass.dispose()}};var Gt=class extends Se{constructor(e,o,n=null,r=null,s=null){super(),this.scene=e,this.camera=o,this.overrideMaterial=n,this.clearColor=r,this.clearAlpha=s,this.clear=!0,this.clearDepth=!1,this.needsSwap=!1,this._oldClearColor=new ue}render(e,o,n){let r=e.autoClear;e.autoClear=!1;let s,i;this.overrideMaterial!==null&&(i=this.scene.overrideMaterial,this.scene.overrideMaterial=this.overrideMaterial),this.clearColor!==null&&(e.getClearColor(this._oldClearColor),e.setClearColor(this.clearColor,e.getClearAlpha())),this.clearAlpha!==null&&(s=e.getClearAlpha(),e.setClearAlpha(this.clearAlpha)),this.clearDepth==!0&&e.clearDepth(),e.setRenderTarget(this.renderToScreen?null:n),this.clear===!0&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),e.render(this.scene,this.camera),this.clearColor!==null&&e.setClearColor(this._oldClearColor),this.clearAlpha!==null&&e.setClearAlpha(s),this.overrideMaterial!==null&&(this.scene.overrideMaterial=i),e.autoClear=r}};var Wn={name:"OutputShader",uniforms:{tDiffuse:{value:null},toneMappingExposure:{value:1}},vertexShader:`
		precision highp float;

		uniform mat4 modelViewMatrix;
		uniform mat4 projectionMatrix;

		attribute vec3 position;
		attribute vec2 uv;

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`
	
		precision highp float;

		uniform sampler2D tDiffuse;

		#include <tonemapping_pars_fragment>
		#include <colorspace_pars_fragment>

		varying vec2 vUv;

		void main() {

			gl_FragColor = texture2D( tDiffuse, vUv );

			// tone mapping

			#ifdef LINEAR_TONE_MAPPING

				gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );

			#elif defined( REINHARD_TONE_MAPPING )

				gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );

			#elif defined( CINEON_TONE_MAPPING )

				gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );

			#elif defined( ACES_FILMIC_TONE_MAPPING )

				gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );

			#elif defined( AGX_TONE_MAPPING )

				gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );

			#elif defined( NEUTRAL_TONE_MAPPING )

				gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );

			#endif

			// color space

			#ifdef SRGB_TRANSFER

				gl_FragColor = sRGBTransferOETF( gl_FragColor );

			#endif

		}`};var Nt=class extends Se{constructor(){super();let e=Wn;this.uniforms=ht.clone(e.uniforms),this.material=new zn({name:e.name,uniforms:this.uniforms,vertexShader:e.vertexShader,fragmentShader:e.fragmentShader}),this.fsQuad=new uo(this.material),this._outputColorSpace=null,this._toneMapping=null}render(e,o,n){this.uniforms.tDiffuse.value=n.texture,this.uniforms.toneMappingExposure.value=e.toneMappingExposure,(this._outputColorSpace!==e.outputColorSpace||this._toneMapping!==e.toneMapping)&&(this._outputColorSpace=e.outputColorSpace,this._toneMapping=e.toneMapping,this.material.defines={},no.getTransfer(this._outputColorSpace)===Mn&&(this.material.defines.SRGB_TRANSFER=""),this._toneMapping===vn?this.material.defines.LINEAR_TONE_MAPPING="":this._toneMapping===bn?this.material.defines.REINHARD_TONE_MAPPING="":this._toneMapping===wn?this.material.defines.CINEON_TONE_MAPPING="":this._toneMapping===oo?this.material.defines.ACES_FILMIC_TONE_MAPPING="":this._toneMapping===xn?this.material.defines.AGX_TONE_MAPPING="":this._toneMapping===En&&(this.material.defines.NEUTRAL_TONE_MAPPING=""),this.material.needsUpdate=!0),this.renderToScreen===!0?(e.setRenderTarget(null),this.fsQuad.render(e)):(e.setRenderTarget(o),this.clear&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),this.fsQuad.render(e))}dispose(){this.material.dispose(),this.fsQuad.dispose()}};var zr=document.getElementById("slab"),$e=document.documentElement,So=matchMedia("(prefers-reduced-motion: reduce)").matches,k=matchMedia("(max-width: 760px)").matches,ir=matchMedia("(prefers-color-scheme: dark)"),P;try{P=new _n({canvas:zr,antialias:k||devicePixelRatio<1.5,alpha:!1,powerPreference:"high-performance"})}catch{throw $e.classList.add("no-webgl","intro-done"),new Error("WebGL indisponible")}var Gr=Math.min(devicePixelRatio,k?1.5:2),ot=Gr,Wt=Math.min(devicePixelRatio,k?1:1.35);P.setPixelRatio(ot);P.shadowMap.enabled=!0;P.shadowMap.type=k?hn:mn;P.shadowMap.autoUpdate=!1;P.toneMapping=oo;P.outputColorSpace=Re;var nt=!0,Ao=!1,je=()=>{nt=!0,Ao||(P.shadowMap.needsUpdate=!0)},_e=k?"geo/m/":"geo/",tn,Ho=k?new Promise(t=>{tn=t}):Promise.resolve(),Q=new io,W=new zo(32,1,.05,4e5),Co=new io,Ve=new zo(32,1,.05,100);Co.add(Ve);var Qo=!1;function V(){Qo||(Qo=!0,requestAnimationFrame(xs))}var A=6,ar=1.3,To=(372-394.2)/A*ar,Nr=new Hn(P),lr=new io,on=new Bt;on.scale.setScalar(1e3);lr.add(on);var Ft=on.material.uniforms,Dt=null,he=new Uo("#fff3e2",3);he.castShadow=!0;he.shadow.mapSize.set(k?2048:4096,k?2048:4096);Object.assign(he.shadow.camera,{left:-62,right:62,top:62,bottom:-62,near:1,far:300});he.shadow.bias=-6e-4;he.shadow.normalBias=.09;Q.add(he,he.target);var cr=new Do("#fbf4e8","#8a8272",.5);Q.add(cr);var nn=new Uo("#ffffff",1.4);nn.position.set(-2,3,4);Ve.add(nn);var Fr=new Do("#ffffff","#8a877f",.9);Co.add(Fr);var Ro={el:31,az:222};{let t=new z().setFromSphericalCoords(1,Ne.degToRad(90-Ro.el),Ne.degToRad(Ro.az));he.position.copy(t).multiplyScalar(150),he.position.z*=-1,he.target.position.set(0,0,0)}var rn={value:null},sn={value:new dt(0,0,1,1)},an={value:0};function Dr(t,e){let o=new Me({map:t,roughness:.95,metalness:0,transparent:e.fade>0});return o.onBeforeCompile=n=>{n.uniforms.uHole={value:e.hole??new dt(0,0,0,0)},n.uniforms.uFade={value:e.fade},n.uniforms.uGain={value:e.gain??1},n.uniforms.uWater=ur,n.uniforms.uHi=rn,n.uniforms.uHiBox=sn,n.uniforms.uHasHi=e.hi?an:{value:0},n.uniforms.uLake={value:e.lakeMask??null},n.uniforms.uHasLake={value:e.lakeMask?1:0},n.uniforms.uLakeY={value:To+.05},n.vertexShader=n.vertexShader.replace("#include <common>",`#include <common>
varying vec3 vWorld;
varying vec2 vUvT;`).replace("#include <begin_vertex>",`#include <begin_vertex>
vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vUvT = uv;`),n.fragmentShader=n.fragmentShader.replace("#include <common>",`#include <common>
varying vec3 vWorld;
varying vec2 vUvT;
uniform vec4 uHole;
uniform float uFade;
uniform float uGain;
uniform vec3 uWater;
uniform float uLakeY;
uniform sampler2D uLake;
uniform float uHasLake;
uniform sampler2D uHi;
uniform vec4 uHiBox;
uniform float uHasHi;
float gWet = 0.0;`).replace("#include <clipping_planes_fragment>",`#include <clipping_planes_fragment>
        if (uHole.z > 0.0 && abs(vWorld.x - uHole.x) < uHole.z && abs(vWorld.z - uHole.y) < uHole.w) discard;`).replace("#include <map_fragment>",`#include <map_fragment>
        if (uHasHi > 0.5) {
          vec2 hu = (vec2(vWorld.x, -vWorld.z) - uHiBox.xy) / (uHiBox.zw - uHiBox.xy);
          float he = min(min(hu.x, 1.0 - hu.x), min(hu.y, 1.0 - hu.y));
          if (he > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uHi, hu).rgb, smoothstep(0.0, 0.05, he));
        }
        diffuseColor.rgb *= uGain;
        // Le lac : l\xE0 o\xF9 le relief est au niveau de l'eau. Une teinte unie, de longues rides douces.
        float wet = uHasLake > 0.5 ? smoothstep(0.3, 0.7, texture2D(uLake, vUvT).r) : 0.0;
        float ripple = sin(vWorld.x * 0.011 + vWorld.z * 0.004) * sin(vWorld.z * 0.013 - vWorld.x * 0.003);
        diffuseColor.rgb = mix(diffuseColor.rgb, uWater * (1.0 + 0.05 * ripple), wet);
        gWet = wet;
        if (uFade > 0.0) {
          float edge = min(min(vUvT.x, 1.0 - vUvT.x), min(vUvT.y, 1.0 - vUvT.y));
          diffuseColor.a *= smoothstep(0.0, uFade, edge);
        }`).replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.62, gWet);`)},o}function Vo(t,e,o,n){let r=t.size/A,s=t.grid,i=s>400||k&&(s-1)%2===0?2:1,c=new so(r,r,(s-1)/i,(s-1)/i);c.rotateX(-Math.PI/2);let a=c.attributes.position,f=c.attributes.uv;for(let u=0;u<a.count;u++){let d=a.getX(u),m=a.getZ(u),h=d/r+.5,p=.5-m/r,v=Math.round(h*(s-1)),w=Math.round(p*(s-1)),b=e[w*s+v]*(t.scale??1)/A*ar;if(n.lake&&(b=Math.max(b,To)),n.sink){let g=Math.min(h,1-h,p,1-p),R=Math.min(1,g/.14);b=Ne.lerp(To-3,b,R*R*(3-2*R))}a.setY(u,b+(n.lift??0)),f.setXY(u,h,1-p)}c.computeVertexNormals();let l=new D(c,Dr(o,n));return l.position.set(t.cx/A,0,t.cz/A),l.renderOrder=n.order??0,l}var Vn=/Version\/(\d+).*Safari/.exec(navigator.userAgent),Ur=typeof createImageBitmap=="function"&&(!Vn||+Vn[1]>=17),fr=new Nn,Or=new Fn().setOptions({imageOrientation:"flipY",premultiplyAlpha:"none",colorSpaceConversion:"none"});function Je(t){let e=o=>(o.colorSpace=Re,o.anisotropy=P.capabilities.getMaxAnisotropy(),o);return new Promise((o,n)=>{if(!Ur)return fr.load(t,r=>o(e(r)),void 0,n);Or.load(t,r=>{let s=new Sn(r);s.flipY=!1,s.needsUpdate=!0,o(e(s))},void 0,n)})}var st=(t,e)=>fetch(t).then(o=>{if(!o.ok)throw new Error(t);return o.arrayBuffer()}).then(o=>new e(o)),ur={value:new ue("#4f6f84")},dr=new ro({color:"#93a7b0"}),ln=new D(new Ln(125e3,96),dr);ln.rotation.x=-Math.PI/2;ln.position.y=To-3.2;Q.add(ln);var yt=new mt;yt.scale.z=-1;Q.add(yt);var Mo=t=>[t[0],t[1],-t[2]],ye=new mt;yt.add(ye);var _o={value:0},hr={value:null},mr={value:new dt(0,0,1,0)},pr={value:new ue("#e7e3da")},gr={value:new ue("#c4bcb6")},vr=new Me({color:"#ffffff",roughness:.85,side:Ze});vr.onBeforeCompile=t=>{Object.assign(t.uniforms,{uStyles:br,uNight:_o,uNear:hr,uNearBox:mr,uHi:rn,uHiBox:sn,uHasHi:an,uWall:pr,uRoof:gr}),t.vertexShader=t.vertexShader.replace("#include <common>",`#include <common>
varying vec3 vLocal;
varying vec3 vUp;
varying vec2 vSpan;`).replace("#include <begin_vertex>",`#include <begin_vertex>
vLocal = position;
vUp = normal;
vSpan = uv;`),t.fragmentShader=t.fragmentShader.replace("#include <common>",`#include <common>
      varying vec3 vLocal;
      varying vec3 vUp;
      varying vec2 vSpan;
      uniform float uNight, uHasHi;
      uniform sampler2D uNear, uHi, uStyles;
      uniform vec4 uNearBox, uHiBox;
      uniform vec3 uWall, uRoof;
      float gGlass = 0.0, gGloss = 0.0, gLit = 0.0;
      vec3 gTilt = vec3(0.0);
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      ${k?"float noise(vec2 p) { return 0.5; }":`float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }`}
      float band(float t, float a, float b, float w) { return smoothstep(a - w, a + w, t) * (1.0 - smoothstep(b - w, b + w, t)); }`).replace("#include <color_fragment>",`#include <color_fragment>
      vec3 up = normalize(vUp);
      float roof = smoothstep(0.42, 0.62, abs(up.y));
      vec2 su = vLocal.xz / 220.0 + 0.5;
      float st = all(greaterThan(su, vec2(0.0))) && all(lessThan(su, vec2(1.0))) ? floor(texture2D(uStyles, su).r * 255.0 + 0.5) : 0.0;
      float below = vSpan.x - vLocal.y, above = vLocal.y - vSpan.y;
      float run = abs(up.x) > abs(up.z) ? vLocal.z : vLocal.x;
      float wr = fwidth(run), wy = fwidth(vLocal.y);
      float dim = uWall.g / 0.77;
      // La photo a\xE9rienne, la plus fine qui couvre ce point.
      vec2 hu = (vLocal.xz - uHiBox.xy) / (uHiBox.zw - uHiBox.xy);
      bool hi = uHasHi > 0.5 && min(min(hu.x, 1.0 - hu.x), min(hu.y, 1.0 - hu.y)) > 0.0;
      vec3 top = hi ? texture2D(uHi, hu).rgb : texture2D(uNear, (vLocal.xz - uNearBox.xy) / uNearBox.z + 0.5).rgb;
      vec3 wall;
      if (st == 1.0) {
        // Le Rolex : la membrane claire de la photo, sans les ombres que la photo a fig\xE9es.
        top = max(top, uRoof * 0.93);
        wall = uRoof;
      } else {
        // Chaque famille de fa\xE7ade, relev\xE9e sur des photos du campus : mati\xE8re, hauteur d'\xE9tage,
        // largeur de trav\xE9e, hauteur et largeur des vitrages, stores, part de verre vue de loin.
        float bid = floor(vSpan.y * 40.0);
        float kind = hash(vec2(bid, 11.0)), tint = hash(vec2(bid, 3.0));
        vec3 skin = uWall * mix(vec3(0.8, 0.79, 0.77), vec3(1.0, 0.985, 0.95), tint);
        vec3 pane0 = vec3(0.09, 0.12, 0.15), pane1 = vec3(0.25, 0.29, 0.31);
        float fh = 0.55, cw = 0.42, rowA = 0.3, rowB = 0.82, fill = 0.7, ribs = 0.0, blinds = 0.42, cover = 0.2, weather = 1.0;
        if (st == 0.0) {
          float curtain = step(kind, 0.16), ribbon = step(0.16, kind) * step(kind, 0.6);
          cw = mix(0.42, 0.28, curtain); rowA = mix(0.3, 0.16, curtain); rowB = mix(0.82, 0.96, curtain);
          fill = mix(0.7, 0.95, max(curtain, ribbon)); cover = mix(mix(0.2, 0.34, ribbon), 0.62, curtain);
        } else if (st == 2.0 || st >= 12.0) {      // ME, MA, CM, PH, GC\u2026 : aluminium clair, bandeaux vitr\xE9s continus
          skin = vec3(0.5, 0.52, 0.54) * dim; fh = 0.62; cw = 0.24; rowA = 0.44; rowB = 0.93; fill = 0.95; ribs = 1.0; blinds = 0.2; cover = 0.42; weather = 0.45;
          pane0 = vec3(0.06, 0.1, 0.14); pane1 = vec3(0.16, 0.24, 0.3);
        } else if (st == 3.0) {      // ELA\u2026, INF\u2026 : le m\xEAme dessin en ocre
          skin = vec3(0.61, 0.52, 0.38) * dim; fh = 0.6; cw = 0.6; rowA = 0.03; rowB = 0.6; fill = 0.82; blinds = 0.1; cover = 0.34; weather = 0.5;
          pane0 = vec3(0.03, 0.05, 0.11); pane1 = vec3(0.08, 0.12, 0.2);
        } else if (st == 4.0) {      // ME D : volets d'aluminium inclin\xE9s
          skin = vec3(0.05, 0.07, 0.09); fh = 0.62; cw = 0.46; rowA = 0.0; rowB = 1.0; fill = 1.0; ribs = 1.0; blinds = 0.0; cover = 0.14; weather = 0.3;
        } else if (st == 5.0) {      // BI : bandes de couleur sur noir
          skin = vec3(0.025); fh = 0.62; cw = 0.3; rowA = 0.12; rowB = 0.9; fill = 0.9; blinds = 0.0; cover = 0.3; weather = 0.2;
        } else if (st == 6.0) {      // BM : enduit gris clair, fen\xEAtres larges \xE0 stores
          skin = vec3(0.47, 0.53, 0.55) * dim; fh = 0.52; cw = 0.5; rowA = 0.26; rowB = 0.8; fill = 0.82; blinds = 0.72; cover = 0.3; weather = 0.7;
        } else if (st == 7.0) {      // SwissTech : mur-rideau bleu
          skin = vec3(0.03, 0.04, 0.05); fh = 0.7; cw = 0.25; rowA = 0.02; rowB = 0.98; fill = 0.97; blinds = 0.0; cover = 0.9; weather = 0.0;
          pane0 = vec3(0.03, 0.09, 0.17); pane1 = vec3(0.09, 0.2, 0.32);
        } else if (st == 8.0) {      // BC : m\xE9tal sombre, hauts vitrages
          skin = vec3(0.03, 0.032, 0.036); fh = 0.62; cw = 0.2; rowA = 0.08; rowB = 0.92; fill = 0.72; blinds = 0.0; cover = 0.45; weather = 0.1;
        } else if (st == 9.0) {      // RTS : bo\xEEtes min\xE9rales taupe, tr\xE8s grandes baies
          skin = vec3(0.82, 0.81, 0.78) * dim; fh = 0.62; cw = 1.0; rowA = 0.27; rowB = 0.76; fill = 0.7; blinds = 0.0; cover = 0.26; weather = 0.1;
        } else if (st == 10.0) {     // RTS : la dalle suspendue, vitr\xE9e, travers\xE9e de poutres Warren
          skin = vec3(0.8) * dim; fh = 1.0; cw = 0.4; rowA = 0.07; rowB = 0.93; fill = 1.0; blinds = 0.0; cover = 0.75; weather = 0.2;
          pane0 = vec3(0.08, 0.12, 0.14); pane1 = vec3(0.2, 0.25, 0.26);
        } else if (st == 11.0) {     // ArtLab : bois sous un long toit sombre
          skin = vec3(0.33, 0.19, 0.09) * dim; fh = 1.0; cw = 0.5; rowA = 0.05; rowB = 0.92; fill = 0.86; blinds = 0.0; cover = 0.5; weather = 0.3;
        }
        vec2 wp = vec2(run, vLocal.y);
        float stain = noise(wp * vec2(1.1, 0.6)) * 0.6 + noise(wp * vec2(4.5, 1.4)) * 0.4;
        float drip = noise(vec2(run * 11.0, vLocal.y * 0.5));
        skin *= mix(1.0, 0.9 + 0.17 * stain, weather) * mix(mix(1.0, 0.8, weather), 1.0, smoothstep(0.0, 0.55, above));
        if (st == 5.0 && above > 0.62) {
          float s = floor(run / 0.75), c6 = s - 6.0 * floor(s / 6.0);
          skin = c6 < 1.0 ? vec3(0.9, 0.55, 0.02) : c6 < 2.0 ? vec3(0.02, 0.26, 0.09) : c6 < 3.0 ? vec3(0.85, 0.2, 0.02) : c6 < 4.0 ? vec3(0.02, 0.1, 0.42) : c6 < 5.0 ? vec3(0.95, 0.72, 0.03) : vec3(0.6, 0.04, 0.03);
          skin *= dim;
          fill = 0.0;
        }
        float lvl = above / fh, col = run / cw;
        float fy = fract(lvl), fx = fract(col);
        float wl = fwidth(lvl), wc = fwidth(col);
        float win = band(fy, rowA, rowB, wl) * band(fx, 0.5 - fill * 0.5, 0.5 + fill * 0.5, wc);
        float detail = 1.0 - smoothstep(0.04, 0.12, max(wr, wy));
        vec2 pid = vec2(floor(col), floor(lvl)) + bid;
        float r1 = hash(pid), r2 = hash(pid + 7.0), r3 = hash(pid + 13.0);
        float t = clamp((fy - rowA) / (rowB - rowA), 0.0, 1.0);
        float blind = step(1.0 - blinds, r2) * step(1.0 - r1 * 0.85, t);
        vec3 pane = mix(pane0, pane1, r3);
        pane = mix(pane, vec3(0.62, 0.6, 0.55) * (0.9 + 0.1 * sin(t * 60.0)), blind);
        pane *= 1.0 - 0.5 * smoothstep(rowB - 0.08, rowB, fy);
        float sill = band(fy, rowA - 0.04, rowA, wl);
        float under = smoothstep(rowA, 0.0, fy);
        vec3 near = skin * (1.0 - 0.16 * under * drip * weather) * (1.0 + 0.12 * sill);
        near *= 1.0 - 0.14 * band(fy, 0.0, 0.015, wl);
        near *= 1.0 - 0.12 * ribs * step(0.5, fract(vLocal.y / 0.05));
        if (st == 4.0) {
          // Des volets de biais, chacun pench\xE9 \xE0 sa fa\xE7on ; un sur quatre ouvert sur le verre.
          float sk = (r1 - 0.5) * 0.7;
          float gx = fract(col + (fy - 0.5) * sk);
          float gap = 1.0 - band(gx, 0.05, 0.95, wc);
          near = mix(skin * (0.82 + 0.36 * r3), vec3(0.03), gap);
          near *= 1.0 - 0.14 * step(0.5, fract(vLocal.y / 0.035));
          win = step(0.76, r2) * (1.0 - gap);
        }
        if (st == 9.0) {
          // Trois meneaux par baie.
          float m3 = 1.0 - band(fract((fx - 0.1) / 0.8 * 3.0), 0.04, 0.96, wc * 3.0);
          pane = mix(pane, skin * 0.5, m3);
        }
        float blend = st == 4.0 ? 0.14 : cover;
        vec3 far = mix(skin, mix(pane0, pane1, 0.5), blend);
        win *= step(0.3 * step(st, 0.5), above);
        wall = mix(far, mix(near, pane, win), detail);
        gGlass = win * detail;
        gGloss = win * (1.0 - blind) * detail * 0.85;
        gTilt = (vec3(r1, r2, r3) - 0.5) * 0.09 * gGloss;
        gLit = win * step(0.72, r2) * (0.4 + 0.8 * r3) * uNight;
        if (st == 10.0 && above > 1.0) { wall = vec3(0.14, 0.2, 0.24) * dim; gGlass = 1.0; gGloss = 0.8; gTilt = vec3(0.0); gLit = 0.0; }
        // Sur les photos, la RTS est un chantier : ses toits sont dessin\xE9s. Le dessous de la dalle est en bois.
        if (st == 9.0) top = vec3(0.72, 0.71, 0.69) * dim;
        if (st == 10.0) {
          top = vec3(0.78, 0.77, 0.74) * dim;
          if (above < 0.05) top = vec3(0.42, 0.25, 0.12) * dim * (0.9 + 0.2 * noise(vLocal.xz * vec2(14.0, 1.2)));
        }
        top = mix(top, vec3(dot(top, vec3(0.333))), 0.12);
      }
      diffuseColor.rgb = mix(wall, top, roof);
      gGlass *= 1.0 - roof; gGloss *= 1.0 - roof; gLit *= 1.0 - roof;`).replace("#include <normal_fragment_maps>",`#include <normal_fragment_maps>
normal = normalize(normal + gTilt);`).replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.1, gGloss);`).replace("#include <metalnessmap_fragment>",`#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.75, gGloss);`).replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.64, 0.32) * gLit * 0.34;`)};var Xn=new mo().setDecoderPath("geo/draco/"),Rt=t=>P.compileAsync(t,W,Q).catch(()=>{}),br={value:null},wr=Ho.then(()=>new Promise((t,e)=>Xn.load(`${_e}campus.drc`,async o=>{let n=await Je("geo/styles.png");n.colorSpace=Bo,n.magFilter=n.minFilter=yn,n.generateMipmaps=!1,n.anisotropy=1,n.needsUpdate=!0,br.value=n;let r=new D(o,vr);r.castShadow=r.receiveShadow=!0,r.customDepthMaterial=new Cn({depthPacking:Tn,side:Ze}),r.customDepthMaterial.onBeforeCompile=s=>{s.vertexShader=s.vertexShader.replace("#include <begin_vertex>",`#include <begin_vertex>
      if (abs(position.x) < 14.2 && abs(position.z) < 10.45) transformed.y -= 0.3;`)},await Rt(r),ye.add(r),Xn.dispose(),je(),V(),t(!0)},void 0,e))),xr=new Me({color:"#ffffff",roughness:.9});xr.onBeforeCompile=t=>{t.vertexShader=t.vertexShader.replace("#include <common>",`#include <common>
varying vec3 vLeaf;`).replace("#include <begin_vertex>",`#include <begin_vertex>
vLeaf = position;`),t.fragmentShader=t.fragmentShader.replace("#include <common>",`#include <common>
      varying vec3 vLeaf;
      float leaves(vec3 p) { return sin(p.x + sin(p.y * 0.83) * 1.7) * sin(p.y + sin(p.z * 0.77) * 1.9) * sin(p.z + sin(p.x * 0.71) * 1.3); }`).replace("#include <color_fragment>",`#include <color_fragment>
      float clump = leaves(vLeaf * 9.0) * 0.6 + leaves(vLeaf * 23.0) * 0.4;
      diffuseColor.rgb *= (0.8 + 0.42 * clump) * mix(0.42, 1.18, smoothstep(-0.75, 0.85, vLeaf.y));`)};var Wr=new Me({color:"#4f4034",roughness:.95}),$n=17,gt=()=>($n=$n*16807%2147483647)/2147483647,jn=new _t,Xo=new An,Ce=new z,Yn=new z,Vr=new z(0,1,0);function $o(t,e){let o=e.map(([r,s,i,c])=>{let a=new In(c,t),f=a.attributes.position;for(let l=0;l<f.count;l++){Ce.fromBufferAttribute(f,l);let u=1+.1*Math.sin(Ce.x*11+i*9)*Math.cos(Ce.z*9+r*7)+.06*Math.sin(Ce.y*19+r*5);f.setXYZ(l,Ce.x*u+r,Ce.y*u+s,Ce.z*u+i)}return a}),n=Un(Wo(o),1e-4);return n.computeVertexNormals(),n}var jo=[[0,.12,0,.72],[.46,-.08,.16,.52],[-.42,-.04,.3,.54],[.08,-.06,-.48,.54],[-.3,.1,-.34,.46],[.34,.2,-.26,.44],[-.1,.52,.02,.46],[.2,.42,.28,.4]],Er=Ho.then(()=>st(`${_e}trees.bin`,Float32Array)).then(async t=>{let e=t.length/4,o=[{within:30,geo:$o(k?1:2,k?jo.slice(0,5):jo),list:[]},{within:80,geo:$o(1,jo.slice(0,k?3:5)),list:[]},{within:1/0,geo:$o(k?0:1,[[0,0,0,.98]]),list:[]}];for(let i=0;i<e;i++)o.find(c=>Math.hypot(t[i*4],t[i*4+1])<c.within).list.push(i);let n=new ao(new lo(.03,.06,1,6),Wr,o[0].list.length+o[1].list.length),r=new ue,s=0;for(let[i,c]of o.entries()){let a=new ao(c.geo,xr,c.list.length);c.list.forEach((f,l)=>{let u=t[f*4],d=t[f*4+1],m=t[f*4+2],h=Math.max(.7,t[f*4+3]),p=h*(.33+gt()*.08),v=.92+gt()*.22;Xo.setFromAxisAngle(Vr,gt()*6.28),a.setMatrixAt(l,jn.compose(Ce.set(u,m+h-p*v*.86,d),Xo,Yn.set(p,p*v,p))),r.setHSL(.235+gt()*.06,.3+gt()*.14,.19+gt()*.08),a.setColorAt(l,r),i<2&&n.setMatrixAt(s++,jn.compose(Ce.set(u,m+h*.3,d),Xo,Yn.set(h*.8,h*.6,h*.8)))}),a.castShadow=!0,a.receiveShadow=i<2,await Rt(a),ye.add(a)}n.castShadow=!0,await Rt(n),ye.add(n),je(),V()}),O=1/A,Vt=t=>new ue(t),at=0,wo=1,Xr=2,lt=3,yr=4,q=class{constructor(){this.body=[],this.glass=[]}paint(e,o,n){let r=e.index?e.toNonIndexed():e,s=r.attributes.position.count,i=Vt(o),c=new Float32Array(s*3),a=new Float32Array(s).fill(n);for(let f=0;f<s;f++)c.set([i.r,i.g,i.b],f*3);r.setAttribute("color",new Y(c,3)),r.setAttribute("aKind",new Y(a,1));for(let f of Object.keys(r.attributes))["position","normal","color","aKind"].includes(f)||r.deleteAttribute(f);return this.body.push(r),this}box(e,o,n,r,s,i,c,a=at,f=0){let l=new Qe(r-e,s-o,i-n);return f&&l.rotateX(f),l.translate((e+r)/2,(o+s)/2,(n+i)/2),this.paint(l,c,a)}pane(e,o,n,r,s){let i=new so(n-e,r-o);i.translate((e+n)/2,(o+r)/2,s);let c=i.toNonIndexed();return c.deleteAttribute("uv"),this.glass.push(c),this}sheet(e,o,n,r,s,i,c){let a=new so(n-e,r-o);return a.translate((e+n)/2,(o+r)/2,s),this.paint(a,i,c)}pillow(e,o,n,r,s,i,c,a,f,l,u=.03,d=2){let m=(v,w,b,g,R,T)=>(v.moveTo(w+T,b),v.lineTo(g-T,b),v.quadraticCurveTo(g,b,g,b+T),v.lineTo(g,R-T),v.quadraticCurveTo(g,R,g-T,R),v.lineTo(w+T,R),v.quadraticCurveTo(w,R,w,R-T),v.lineTo(w,b+T),v.quadraticCurveTo(w,b,w+T,b),v),h=m(new No,e,o,n,r,s);l&&h.holes.push(m(new Bn,l[0],l[1],l[2],l[3],l[4]));let p=new co(h,{depth:c,bevelEnabled:u>0,bevelThickness:u,bevelSize:u,bevelOffset:-u,bevelSegments:1,curveSegments:d});return p.translate(0,0,i),this.paint(p,a,f)}done(){let e=o=>{if(!o.length)return null;let n=Wo(o),r=n.attributes.normal,s=[];for(let i=0;i<r.count;i+=3)r.getZ(i)+r.getZ(i+1)+r.getZ(i+2)>-1.5&&s.push(i);for(let i of Object.keys(n.attributes)){let c=n.attributes[i],a=c.itemSize,f=new Float32Array(s.length*3*a);s.forEach((l,u)=>f.set(c.array.subarray(l*a,(l+3)*a),u*3*a)),n.setAttribute(i,new Y(f,a))}return n.scale(O,O,O),n};return{body:e(this.body),glass:e(this.glass)}}},Ae="#a9adb2",$r="#26282b",jr="#cdbfa6",De="#1d3760",Pe="#e4e3de",Yr="#9aa7aa";function qn(t){let e=new q;e.box(0,0,0,7.2,3.75,.05,$r);for(let[o,n]of[[.02,.93],[.95,1.86]])for(let[r,s]of[[.03,4.3],[4.34,7.17]])if(t){e.pillow(r,o,s,n,.16,.08,.2,Ae,at,null,.05);let i=(r+s)/2;e.sheet(r+.24,o+.2,i-.08,n-.2,.36,Ae,wo),e.sheet(i+.08,o+.2,s-.24,n-.2,.36,Ae,wo)}else e.box(r,o,.05,s,n,.32,Ae,wo);t?e.pillow(.04,1.88,7.16,3.73,.16,.08,.2,Ae,at,[.26,2.04,6.94,3.58,.14],.04):(e.box(.04,1.88,.05,7.16,2.04,.32,Ae),e.box(.04,3.58,.05,7.16,3.73,.32,Ae),e.box(.04,2.04,.05,.26,3.58,.32,Ae),e.box(6.94,2.04,.05,7.16,3.58,.32,Ae));for(let o of[1.42,2.72,4.78,6.42])e.box(o-.04,2.04,.06,o+.04,3.58,.13,"#3b4648");return t&&(e.box(.26,3.5,.06,6.94,3.58,.13,"#3b4648"),e.box(.26,2.04,.06,6.94,2.1,.16,"#3b4648")),e.pane(.26,2.04,6.94,3.58,.08),e.done()}function qr(){let t=new q;return t.pillow(0,0,3.6,3.6,.001,0,.26,jr,Xr,[.33,.12,3.25,2.14,.001],0,1),t.box(.33,.12,.02,3.25,.22,.14,De),t.box(.33,2.04,.02,3.25,2.14,.14,De),t.box(.33,.12,.02,.43,2.14,.14,De),t.box(3.15,.12,.02,3.25,2.14,.14,De),t.box(1.76,.12,.02,1.92,2.14,.15,De),t.box(.86,.22,.02,.98,1.68,.14,De),t.box(.43,1.66,.02,3.15,1.78,.14,De),t.box(.3,.04,.1,3.28,.13,.32,De,at,-.2),t.pane(.33,.12,3.25,2.14,.06),t.done()}function Kn(t){let e=new q;e.pillow(0,0,6,3.3,.001,0,.2,Yr,lt,[.42,.62,5.58,2.62,.001],0,1),e.box(.42,.62,.03,5.58,.7,.1,Pe),e.box(.42,2.54,.03,5.58,2.62,.1,Pe),e.box(.42,.62,.03,.5,2.62,.1,Pe),e.box(5.5,.62,.03,5.58,2.62,.1,Pe),e.box(2.95,.62,.03,3.05,2.62,.11,Pe),e.box(.38,.54,.1,5.62,.6,.27,"#c8cbcb");let o=[t?.25:.9,t?.72:.5];for(let[n,r,s]of[[0,.5,2.95],[1,3.05,5.5]])for(let i=2.5;i>2.54-1.9*o[n];i-=.075)e.box(r,i-.03,.1,s,i+.03,.115,"#8b8f91",at,.5);return e.pane(.42,.62,5.58,2.62,.05),e.done()}function Kr(){let t=new q;t.pillow(0,0,6,3.7,.001,0,.16,"#eceae5",lt,[.9,1,5.1,2.8,.001],0,1),t.box(.9,1,.03,5.1,1.06,.09,"#dcdbd6"),t.box(.9,2.74,.03,5.1,2.8,.09,"#dcdbd6");for(let o of[.93,1.95,3,4.05,5.07])t.box(o-.03,1,.03,o+.03,2.8,.09,"#dcdbd6");return t.pane(.9,1,5.1,2.8,.05),t.done()}function Zr(t,e,o,n){let r=new q;return r.box(0,0,0,n,e,.16,o),r.box(0,0,0,t,n,.12,o),r.pane(0,0,t,e,.04),r.done()}function Qr(){let t=new q;return t.box(0,0,0,3.6,3.7,.04,"#0d0e10"),t.sheet(0,0,1.5,3.7,.14,"#17181b",yr),t.box(1.5,0,.04,1.58,3.7,.16,"#17181b"),t.box(3.52,0,.04,3.6,3.7,.16,"#17181b"),t.pane(1.58,.1,3.52,3.6,.06),t.done()}function Jr(){let t=new q;t.box(0,0,0,1.2,3,.05,"#2f2013");for(let e=.05;e<1.2;e+=.2)t.box(e,0,.05,e+.13,3,.13,"#7d5730");return t.done()}function es(){let t=new q,e="#eae8e3";return t.box(0,0,0,2.4,1.3,.1,e,lt),t.box(0,4.9,0,2.4,6,.1,e,lt),t.box(0,1.3,.02,.07,4.9,.14,"#c9cbcb"),t.box(0,3.55,.02,2.4,3.61,.12,"#c9cbcb"),t.pane(0,1.3,2.4,4.9,.04),t.done()}function ts(){let t=new q,e="#b4371f",o="#14151a",n="#23252a";t.box(0,0,0,7.2,.35,.16,e);for(let r of[.5,2.55,4.6,6.65]){t.box(r-.1,.35,.02,r+.1,3.4,.22,e);let s=new Qe(.08,.08,1.9);s.rotateX(.38),s.translate(r,3.05,1),t.paint(s,n,at)}for(let r of[1.03,1.53,2.03,3.07,3.57,4.07,5.12,5.62,6.12])t.box(r-.025,.35,.02,r+.025,3.4,.08,"#2b2d30");return t.box(0,2.45,.02,7.2,2.5,.08,"#2b2d30"),t.box(0,3.4,0,7.2,3.62,2.1,o),t.box(0,3.3,1.95,7.2,3.4,2.1,n),t.pane(0,.35,7.2,3.4,.03),t.done()}function os(){let t=new q,e="#c9c5bb",o="#9fa4a6";t.box(0,0,0,.42,3.6,.42,e,lt),t.box(.42,0,0,3.6,.14,.2,e,lt);for(let n=.2;n<1.05;n+=.1)t.box(.42,n,.05,3.6,n+.07,.09,o,at,.5);t.box(.42,1.06,.02,3.6,1.14,.1,Pe),t.box(.42,3.52,.02,3.6,3.6,.1,Pe);for(let n of[1.9,2.72])t.box(.42,n-.025,.02,3.6,n+.025,.09,Pe);for(let n of[1.48,2.54])t.box(n-.025,1.14,.02,n+.025,3.52,.09,Pe);return t.pane(.42,1.14,3.6,3.52,.03),t.done()}function ns(){let t=new q;return t.box(-.11,0,-.11,.11,1,.11,"#2b2d31"),t.done()}function rs(){let t=new q;return t.box(0,0,0,1,1,.12,"#ffffff",lt),t.done()}function ss(){let t=new q;return t.box(0,0,0,1,1,.07,"#b8bcc0",wo),t.done()}function is(){let t=new q;return t.box(0,0,0,1,1,.05,"#ffffff",yr),t.done()}function as(){let t=new q;return t.box(-.035,0,0,.035,1,.16,"#15171a"),t.done()}var Xt=new Me({vertexColors:!0,roughness:.62,metalness:.12});Xt.onBeforeCompile=t=>{t.vertexShader=t.vertexShader.replace("#include <common>",`#include <common>
attribute float aKind;
varying float vKind;
varying vec3 vM;
varying float vCell;`).replace("#include <begin_vertex>",`#include <begin_vertex>
      vKind = aKind; vM = position * ${A.toFixed(1)};
      vCell = float(gl_InstanceID);`),t.fragmentShader=t.fragmentShader.replace("#include <common>",`#include <common>
      varying float vKind; varying vec3 vM; varying float vCell;
      float fh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float fn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(fh(i), fh(i + vec2(1, 0)), f.x), mix(fh(i + vec2(0, 1)), fh(i + vec2(1, 1)), f.x), f.y); }
      float gHeight = 0.0; float gRough = -1.0; float gMetal = -1.0;`).replace("#include <color_fragment>",`#include <color_fragment>
      float k = floor(vKind + 0.5);
      vec2 q = vM.xy;
      float px = max(fwidth(q.x), fwidth(q.y));
      float wash = 0.93 + 0.12 * fn(q * 0.5 + vCell * 0.37);
      if (k == 1.0) {
        // Les persiennes de la t\xF4le : de fines nervures horizontales.
        float vis = 1.0 - smoothstep(0.012, 0.032, px);
        float s = fract(q.y / 0.07);
        gHeight = (smoothstep(0.1, 0.3, s) - smoothstep(0.55, 0.8, s)) * 0.012 * vis;
        diffuseColor.rgb *= mix(0.86, 1.0 - 0.42 * smoothstep(0.62, 0.9, s), vis);
        gMetal = 0.72; gRough = 0.38;
      } else if (k == 2.0) {
        // Le carrelage : 24 cm, joints sombres, chaque carreau un peu diff\xE9rent.
        vec2 t = q / 0.24, c = floor(t), f = abs(fract(t) - 0.5);
        float vis = 1.0 - smoothstep(0.008, 0.024, px);
        float joint = smoothstep(0.455, 0.49, max(f.x, f.y));
        diffuseColor.rgb *= mix(0.9, (0.93 + 0.13 * fh(c)) * (1.0 - 0.72 * joint), vis) * wash;
        gHeight = -joint * 0.004 * vis;
        gRough = 0.34;
      } else if (k == 3.0) {
        float vis = 1.0 - smoothstep(0.01, 0.04, px);
        gHeight = fn(q * 40.0) * 0.003 * vis;
        diffuseColor.rgb *= wash;
        gRough = 0.86;
      } else if (k == 4.0) {
        float vis = 1.0 - smoothstep(0.02, 0.07, px);
        float s = fract(q.x / 0.12);
        gHeight = smoothstep(0.2, 0.5, abs(s - 0.5) * 2.0) * 0.012 * vis;
        diffuseColor.rgb *= 1.0 - 0.3 * vis * smoothstep(0.7, 1.0, abs(s - 0.5) * 2.0);
        gMetal = 0.4; gRough = 0.45;
      } else {
        diffuseColor.rgb *= wash;
        gMetal = 0.45; gRough = 0.42;
      }`).replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
if (gRough >= 0.0) roughnessFactor = gRough;`).replace("#include <metalnessmap_fragment>",`#include <metalnessmap_fragment>
if (gMetal >= 0.0) metalnessFactor = gMetal;`).replace("#include <normal_fragment_maps>",`#include <normal_fragment_maps>
      {
        vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
        vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
        float det = dot(sx, r1) * faceDirection;
        vec3 grad = sign(det) * (dFdx(gHeight) * ${(1/A).toFixed(4)} * r1 + dFdy(gHeight) * ${(1/A).toFixed(4)} * r2) * 6.0;
        normal = normalize(abs(det) * normal - grad);
      }`)};var Tr=new Me({color:"#3c4a55",roughness:.07,metalness:.82,side:Ze});Tr.onBeforeCompile=t=>{t.uniforms.uNight=_o,t.vertexShader=t.vertexShader.replace("#include <common>",`#include <common>
varying float vId;
varying vec2 vPane;`).replace("#include <begin_vertex>",`#include <begin_vertex>
      vId = float(gl_InstanceID);
      vPane = position.xy * ${A.toFixed(1)};
      // Chaque vitre penche d'un rien : elle n'attrape pas le m\xEAme morceau de ciel que sa voisine.
      vNormal = normalize(vNormal + normalMatrix * vec3((vec2(fract(sin(vId * 12.99) * 437.5), fract(sin(vId * 78.23) * 437.5)) - 0.5) * 0.05, 0.0));`),t.fragmentShader=t.fragmentShader.replace("#include <common>",`#include <common>
      uniform float uNight; varying float vId; varying vec2 vPane;
      float gh(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }`).replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>
      // La nuit, fen\xEAtre par fen\xEAtre : un bureau sur quatre allum\xE9, chacun \xE0 sa lumi\xE8re, plus claire
      // vers le plafond, parfois derri\xE8re un store \xE0 moiti\xE9 baiss\xE9.
      vec2 room = vec2(floor(vPane.x / 1.8), vId);
      float on = step(0.74, gh(room));
      float tone = gh(room + 3.1), level = 0.1 + 0.3 * gh(room + 7.7);
      vec3 lamp = tone < 0.55 ? vec3(1.0, 0.6, 0.27) : tone < 0.85 ? vec3(1.0, 0.76, 0.5) : vec3(0.72, 0.84, 1.0);
      float h = fract(vPane.y / 3.6);
      float blind = step(0.6, gh(room + 11.0)) * smoothstep(0.42, 0.46, h);
      float falloff = (0.45 + 0.55 * h) * (1.0 - 0.75 * blind);
      totalEmissiveRadiance += lamp * on * level * falloff * uNight;
      diffuseColor.rgb *= 0.8 + 0.5 * fract(sin(vId * 33.1) * 437.5);`)};var Rr={value:new z},Mr=new Me({color:"#1b2429",roughness:.06,metalness:.5,side:Ze});Mr.onBeforeCompile=t=>{t.uniforms.uNight=_o,t.uniforms.uEye=Rr,t.vertexShader=t.vertexShader.replace("#include <common>",`#include <common>
attribute float aCeil;
attribute float aBase;
varying float vCeil;
varying float vBase;
varying vec3 vIn;`).replace("#include <begin_vertex>",`#include <begin_vertex>
vCeil = aCeil;
vBase = aBase;
vIn = position;`),t.fragmentShader=t.fragmentShader.replace("#include <common>",`#include <common>
uniform float uNight;
uniform vec3 uEye;
varying float vCeil;
varying float vBase;
varying vec3 vIn;`).replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>
      vec3 ray = normalize(vIn - uEye);
      float up = ray.y > 0.0 ? 1.0 : 0.0;
      float plane = mix(vBase, vCeil - 0.05, up);
      float t = abs(plane - vIn.y) / max(abs(ray.y), 0.004);
      vec3 hit = vIn + ray * t;
      float strip = smoothstep(0.42, 0.5, abs(fract(hit.x / 0.9) - 0.5)) * up;
      vec3 room = mix(vec3(0.2, 0.17, 0.13), vec3(0.3, 0.27, 0.22), up) + strip * vec3(1.0, 0.86, 0.62);
      room *= exp(-t * 0.3);
      float facing = abs(dot(normalize(vViewPosition), normal));
      float see = (1.0 - pow(1.0 - facing, 3.0));
      totalEmissiveRadiance += room * see * mix(0.3, 1.0, uNight);`)};var He=.05,Zn=.12,we=.04,Be=new mt;Be.visible=!1;var Yo=new mt,Sr=Ho.then(()=>Promise.all([st(`${_e}walls.bin`,Float32Array),st("geo/rolex.bin",Float32Array),st("geo/canopies.bin",Float32Array)])).then(async([t,e,o])=>{let n=k?0:44,r=k?95:135,s=new _t,i=new _t,c=new _t,a=new Map,f=(x,B,X,$)=>{let M=a.get(x);M||a.set(x,M={kit:B,matrices:[],colors:[]}),M.matrices.push(X.clone()),M.colors.push($)},l={aluHi:qn(!0),aluLo:qn(!1),tile:qr(),bmA:Kn(!0),bmB:Kn(!1),rts:Kr(),top:ts(),mx:os(),plain:rs(),post:ns(),swiss:Zr(1.8,3.6,"#0a0c0f",.09),bc:Qr(),wood:Jr(),slab:es(),shutter:ss(),rib:is(),mull:as()},u={top:[7.2,3.75],mx:[3.6,3.6],aluHi:[7.2,3.75],aluLo:[7.2,3.75],tile:[3.6,3.6],bmA:[6,3.3],rts:[6,3.7],swiss:[1.8,3.6],bc:[3.6,3.7],wood:[1.2,3],slab:[2.4,6]},d=["#d98a12","#2a2c30","#c9241a","#2a2c30","#e0b21a","#14613a","#2a2c30","#14306f"],m=11,h=()=>(m=m*16807%2147483647)/2147483647;for(let x=0;x<t.length;x+=10){let[B,X,$,M,_,me,ze,S,E,L]=t.subarray(x,x+10);if(E===0)continue;let be=(B+$)/2,G=(X+M)/2,ae=Math.hypot(be,G);if(ae>r)continue;let N=S,pe=-ze,Ge=($-B)*N+(M-X)*pe<0,C=Ge?$:B,K=Ge?M:X,y=Math.hypot($-B,M-X),ee=me-_,te=(Z,oe,ne,F,I=1,re=0)=>(s.set(N,0,ze,C+N*Z,0,1,0,oe,pe,0,S,K+pe*Z,0,0,0,1),re&&s.multiply(c.makeRotationZ(re)),s.multiply(i.makeScale(ne,F,I))),j=(Z,oe,ne=ee,F)=>{let[I,re]=u[Z],fe=Math.max(1,Math.round(y/(I*O))),le=Math.max(1,Math.round(ne/((F??re)*O))),Jt=y/fe/(I*O),At=ne/le/(re*O);for(let eo=0;eo<le;eo++)for(let to=0;to<fe;to++){let dn=oe(eo,to,le);f(dn,l[dn.split(":")[0]],te(to*I*O*Jt,_+eo*re*O*At,Jt,At),Po)}},U=`${Math.floor(be/45)},${Math.floor(G/45)}`,Po=E===14?16773330:16777215;if(E!==1){if(E===2||E===12||E===14){if(ee<.45||y<.5)continue;if(E===14&&y<1.1){f(`plain:${U}`,l.plain,te(0,_,y*A,ee*A,1),14206884);continue}let Z=ae<n?"aluHi":"aluLo",oe=E===12&&L>1.2&&ee<1.2;j(oe?"top":Z,()=>oe?`top:${U}`:`${Z}:${U}`)}else if(E===13){if(ee<.45)continue;j("mx",()=>`mx:${U}`)}else if(E===3){if(ee<.45)continue;j("tile",()=>`tile:${U}`)}else if(E===6)j("bmA",(Z,oe)=>(Z*5+oe*3)%7<3?`bmB:${U}`:`bmA:${U}`);else if(E===9)j("rts",()=>`rts:${U}`);else if(E===7)j("swiss",()=>`swiss:${U}`);else if(E===8||E===15)j("bc",()=>`bc:${U}`);else if(E===11)j("wood",()=>`wood:${U}`);else if(E===10){if(ee<.7)continue;j("slab",()=>`slab:${U}`)}else if(E===4){let Z=2.3*O,oe=3.7*O,ne=Math.max(1,Math.round(y/Z)),F=Math.max(1,Math.round(ee/oe)),I=y/ne,re=ee/F;for(let fe=0;fe<F;fe++)for(let le=0;le<ne;le++){if(h()<.24)continue;let Jt=(h()-.5)*.3,At=te((le+.5)*I,_+(fe+.5)*re,I*.92*A,re*.96*A,1,Jt);At.multiply(c.makeTranslation(-.5*O,-.5*O,.34*O)),f(`shutter:${U}`,l.shutter,At,16777215)}}else if(E===5){let Z=2.4*O,oe=Math.max(1,Math.round(y/Z)),ne=y/oe,F=Math.min(ee,3.7*O);for(let I=0;I<oe;I++)f(`rib:${U}`,l.rib,te(I*ne,_,ne*A,F*A,1),2105893),ee>F&&f(`rib:${U}`,l.rib,te(I*ne,_+F,ne*.985*A,(ee-F)*A,1.6),new ue(d[I+Math.floor(C*3)&7]).getHex())}}}for(let x=0;x<o.length;x+=8){let[B,X,$,M,_,me,ze,S]=o.subarray(x,x+8),E=-M,L=$,be=Math.max(1,Math.round(_*2/(7.2*O)));for(let G=0;G<=be;G++)for(let ae of[-1,1]){let N=-_+.1+(_*2-.2)*G/be,pe=ae*Math.max(0,me-.1),Ge=B+$*N+E*pe,C=X+M*N+L*pe;s.makeTranslation(Ge,S,C).multiply(i.makeScale(1,(ze-S)*A,1)),f(`post:${Math.floor(Ge/45)},${Math.floor(C/45)}`,l.post,s,16777215)}}let p=1,v=[];for(let x=0;x<e[0];x++){let B=e[p++];v.push(e.subarray(p,p+B*4)),p+=B*4}let w=e[p++],b=e.subarray(p,p+w*9),g={glass:[],ceil:[],base:[],body:[],color:[],normal:[]},R=Vt("#dcd9d3"),T=Vt("#a9a59c"),Ie=Vt("#c9c6bf"),J=Vt("#8d8a82"),se=(x,B,X,$,M,_)=>{g.body.push(...x,...B,...X,...x,...X,...$);for(let me=0;me<6;me++)g.normal.push(...M),g.color.push(_.r,_.g,_.b)};for(let x of v){let B=x.length/4,X=0,$=0;for(let M=0;M<B;M++){let _=(M+1)%B,me=(M+B-1)%B,ze=(_+1)%B,S=x[M*4],E=x[M*4+1],L=x[M*4+2],be=x[M*4+3],G=x[_*4],ae=x[_*4+1],N=x[_*4+2],pe=x[_*4+3],Ge=(F,I)=>{let re=x[I*4]-x[F*4],fe=x[I*4+2]-x[F*4+2],le=Math.hypot(re,fe)||1;return[fe/le,0,-re/le]},C=Ge(me,_),K=Ge(M,ze),y=(F,I,re,fe,le)=>[F+fe[0]*le,I,re+fe[2]*le],ee=[(C[0]+K[0])/2,0,(C[2]+K[2])/2],te=be+Zn,j=pe+Zn;se(y(S,E-He,L,C,.012),y(G,ae-He,N,K,.012),y(G,ae+.012,N,K,.012),y(S,E+.012,L,C,.012),ee,R),se(y(S,E-He,L,C,-we),y(G,ae-He,N,K,-we),y(G,ae-He,N,K,.012),y(S,E-He,L,C,.012),[0,-1,0],Ie);let U=y(S,te,L,C,-we),Po=y(G,j,N,K,-we),Z=y(G,ae-He,N,K,-we),oe=y(S,E-He,L,C,-we);g.glass.push(...U,...Po,...Z,...U,...Z,...oe),g.ceil.push(E,ae,ae,E,ae,E),g.base.push(te,j,j,te,j,te),se(y(S,be,L,C,.012),y(G,pe,N,K,.012),y(G,j,N,K,.012),y(S,te,L,C,.012),ee,T),se(y(S,te,L,C,.012),y(G,j,N,K,.012),y(G,j,N,K,-we),y(S,te,L,C,-we),[0,1,0],T),se(y(S,be,L,C,-.7),y(G,pe,N,K,-.7),y(G,pe,N,K,.012),y(S,be,L,C,.012),[0,-1,0],J);let ne=Math.hypot(G-S,N-L);if(X>=$){$=X+2.4*O;let F=S-C[0]*(we-.004),I=L-C[2]*(we-.004);s.set(C[2],0,C[0],F,0,1,0,te,-C[0],0,C[2],I,0,0,0,1),s.multiply(i.makeScale(1,(E-He-te)*A,1)),f(`mull:${Math.floor(F/45)},${Math.floor(I/45)}`,l.mull,s,16777215)}X+=ne}}let ie=new Fe;ie.setAttribute("position",new Y(new Float32Array(g.body),3)),ie.setAttribute("normal",new Y(new Float32Array(g.normal),3)),ie.setAttribute("color",new Y(new Float32Array(g.color),3)),ie.setAttribute("aKind",new Y(new Float32Array(g.body.length/3),1));let Te=Xt.clone();Te.onBeforeCompile=Xt.onBeforeCompile,Te.side=Ze;let St=new D(ie,Te);St.castShadow=St.receiveShadow=!0;let qe=new Fe;qe.setAttribute("position",new Y(new Float32Array(g.glass),3)),qe.setAttribute("aCeil",new Y(new Float32Array(g.ceil),1)),qe.setAttribute("aBase",new Y(new Float32Array(g.base),1)),qe.computeVertexNormals();let Ke=new D(qe,Mr);Ke.castShadow=!0;let ct=new Fe;ct.setAttribute("position",new Y(new Float32Array(b),3)),ct.computeVertexNormals();let ft=new D(ct,new Me({color:"#7d7a72",roughness:.9,side:Ze}));ft.castShadow=ft.receiveShadow=!0,Yo.add(St,Ke,ft);let ut=new ue,ko=0;for(let{kit:x,matrices:B,colors:X}of a.values()){let $=B.length,M=(_,me,ze)=>{if(!_)return;let S=new ao(_,me,$);B.forEach((E,L)=>S.setMatrixAt(L,E)),me===Xt&&X.forEach((E,L)=>S.setColorAt(L,ut.set(E))),S.castShadow=ze&&!k,S.receiveShadow=!k,S.computeBoundingSphere(),Be.add(S),ko+=$*_.attributes.position.count/3};M(x.body,Xt,!0),M(x.glass,Tr,!1)}Be.visible=!0,await Rt(Be),await Rt(Yo),Be.visible=ye.scale.y>=.999,ye.add(Yo,Be),je(),V()}),Ar=null,xo=(async()=>{let e=(await(await fetch(`${_e}meta.json`)).json()).layers,[o,n,r,s,i,c]=await Promise.all([st("geo/far.bin",Int16Array),st("geo/mid.bin",Int16Array),Je(`${_e}far.webp`),Je(`${_e}mid.webp`),Je("geo/far-lake.png"),Je("geo/mid-lake.png")]);for(let l of[i,c])l.colorSpace=Bo;let a=(l,u)=>new dt(l.cx/A,-l.cz/A,l.size/A/2*(1-u),l.size/A/2*(1-u));mr.value.set(e.near.cx/A,e.near.cz/A,e.near.size/A,0);let f=new dt(0,0,0,0);return yt.add(Vo(e.far,o,r,{fade:.16,hole:a(e.mid,.36),lake:!0,sink:!0,lakeMask:i})),yt.add(Vo(e.mid,n,s,{fade:.18,hole:f,lake:!0,order:1,lift:.05,gain:.84,lakeMask:c})),Ar=Ho.then(()=>Promise.all([st(`${_e}near.bin`,Int16Array),Je(`${_e}near.webp`)])).then(async([l,u])=>{hr.value=u;let d=Vo(e.near,l,u,{fade:.025,order:2,lift:.08,gain:.86,hi:!0});d.receiveShadow=!0,await Rt(d),yt.add(d),f.copy(a(e.near,.045)),je(),V();let m=()=>Promise.all([Je(`${_e}campus-photo.webp`),fetch("geo/campus-photo.json").then(h=>h.json())]).then(([h,p])=>{rn.value=h,sn.value.set(p.x0,p.z0,p.x1,p.z1),an.value=1,nt=!0,V()}).catch(()=>{});k?Promise.allSettled([wr,Er,Sr]).then(m):m()}).catch(()=>{}),je(),tn?.(),!0})();xo.catch(()=>tn?.());var qo={};function Qn(t){if(qo[t])return qo[t];let e=fr.load(`shots/${t}.webp`,()=>V());return e.colorSpace=Re,e.anisotropy=P.capabilities.getMaxAnisotropy(),qo[t]=e}function $t(t,e,o){let n=new No,r=-t/2,s=-e/2;return n.moveTo(r+o,s),n.lineTo(r+t-o,s),n.absarc(r+t-o,s+o,o,-Math.PI/2,0),n.lineTo(r+t,s+e-o),n.absarc(r+t-o,s+e-o,o,0,Math.PI/2),n.lineTo(r+o,s+e),n.absarc(r+o,s+e-o,o,Math.PI/2,Math.PI),n.lineTo(r,s+o),n.absarc(r+o,s+o,o,Math.PI,Math.PI*1.5),n}function ls(t){t.computeBoundingBox();let e=t.boundingBox,o=t.attributes.position,n=[];for(let r=0;r<o.count;r++)n.push((o.getX(r)-e.min.x)/(e.max.x-e.min.x),(o.getY(r)-e.min.y)/(e.max.y-e.min.y));return t.setAttribute("uv",new Io(n,2)),t}var cs=new pt({color:"#ffffff",roughness:.03,metalness:0,transparent:!0,opacity:.06,clearcoat:1,envMapIntensity:2.5});function fs(t,e,o,n,r){let s=ls(new fo($t(t,e,o),24)),i=new D(s,new ro({toneMapped:!1})),c=new D(s,new ro({toneMapped:!1,transparent:!0,opacity:0})),a=new D(s,cs);return i.position.z=n,c.position.z=n+4e-4,a.position.z=n+.0012,r.add(i,c,a),{a:i,b:c,g:a,current:null,fade:1}}function us(t,e){if(t.current!==e){if(t.current===null){t.a.material.map=Qn(e),t.a.material.needsUpdate=!0,t.current=e;return}t.b.material.map=Qn(e),t.b.material.needsUpdate=!0,t.b.material.opacity=0,t.current=e,t.fade=0}}function ds(t,e){return t.fade>=1?!1:(t.fade=Math.min(1,t.fade+e*1.6+.02),t.b.material.opacity=t.fade,t.fade>=1&&(t.a.material.map=t.b.material.map,t.a.material.needsUpdate=!0,t.b.material.opacity=0),!0)}var Ko=new pt({color:"#a8a196",metalness:1,roughness:.26,clearcoat:.5,envMapIntensity:1.8}),Jn=new pt({color:"#050506",roughness:.06,metalness:.2,clearcoat:1,envMapIntensity:1.4}),er=new pt({color:"#bdb6aa",roughness:.42,metalness:.1,clearcoat:.8,envMapIntensity:1.2}),hs=new pt({color:"#0a0b0f",roughness:.04,metalness:.6,clearcoat:1,envMapIntensity:2}),xe=new mt,bt=.716,wt=1.47,Jo=.112,Oe=.05,ge=.012;{let t=new D(new co($t(bt-2*ge,wt-2*ge,Jo-ge),{depth:Oe,bevelEnabled:!0,bevelThickness:ge,bevelSize:ge,bevelSegments:6,curveSegments:28}),Ko);t.position.z=-Oe/2,xe.add(t);let e=(r,s,i)=>{let c=new D(new fo($t(bt-.004,wt-.004,Jo-.002),28),r);return c.position.z=s,i&&(c.rotation.y=Math.PI),c};xe.add(e(Jn,Oe/2+ge+6e-4),e(er,-Oe/2-ge-6e-4,!0));let o=new D(new fo($t(.205,.06,.03),16),Jn);o.position.set(0,wt/2-.066,Oe/2+ge+.0035),xe.add(o);let n=new D(new co($t(.3,.3,.07),{depth:.012,bevelEnabled:!0,bevelThickness:.004,bevelSize:.004,bevelSegments:3,curveSegments:16}),er);n.position.set(-(bt/2-.2),wt/2-.2,-Oe/2-ge-.012),xe.add(n);for(let[r,s]of[[-.065,.065],[-.065,-.065],[.065,0]]){let i=new D(new lo(.06,.06,.018,40),Ko);i.rotation.x=Math.PI/2,i.position.set(-(bt/2-.2)+r,wt/2-.2+s,-Oe/2-ge-.022);let c=new D(new lo(.046,.046,.02,40),hs);c.rotation.x=Math.PI/2,c.position.set(i.position.x,i.position.y,i.position.z-.002),xe.add(i,c)}for(let[r,s,i]of[[.3,.07,-1],[.17,.12,-1],[.02,.12,-1],[.18,.22,1],[-.2,.13,1]]){let c=new D(new ho(.014,s,.026,2,.006),Ko);c.position.set(i*(bt/2+.004),r,0),xe.add(c)}}var tr=fs(bt-.05,wt-.05,Jo-.022,Oe/2+ge+.0012,xe);Ve.add(xe);function Hr(){let t=ir.matches;Ft.turbidity.value=t?2:3.2,Ft.rayleigh.value=t?2.6:2.1,Ft.mieCoefficient.value=.004,Ft.mieDirectionalG.value=.82;let e=new z().setFromSphericalCoords(1,Ne.degToRad(90-(t?-1.2:Ro.el)),Ne.degToRad(Ro.az));Ft.sunPosition.value.copy(e),Dt&&Dt.dispose(),Dt=Nr.fromScene(lr),Q.environment=Dt.texture,Co.environment=Dt.texture,Q.environmentIntensity=t?.45:.32,P.toneMappingExposure=t?.8:.62,Q.fog=new kn(t?"#1b2433":"#a8bac3",5e-5);let o=document.createElement("canvas");o.width=2,o.height=256;let n=o.getContext("2d"),r=n.createLinearGradient(0,0,0,256);r.addColorStop(0,t?"#070b14":"#8eacc2"),r.addColorStop(.48,t?"#1b2433":"#a8bac3"),r.addColorStop(1,t?"#1b2433":"#a8bac3"),n.fillStyle=r,n.fillRect(0,0,2,256),Q.background?.dispose?.(),Q.background=new Pn(o),Q.background.colorSpace=Re,dr.color.set(t?"#10161c":"#93a7b0"),_o.value=t?1:0,pr.value.set(t?"#8a8d92":"#e7e3da"),gr.value.set(t?"#8f9298":"#c4bcb6"),ur.value.set(t?"#16222f":"#4f6f84"),he.color.set(t?"#8fa8d0":"#fff3e2"),he.intensity=t?1.6:3.8,cr.intensity=t?1.1:.55,nn.intensity=t?1:1.4,je()}var en=(t,e,o,n,r,s,i=1)=>({x:t,y:e,d:o,ry:n,rx:r,screen:s,on:i}),vt=en(.45,-1.6,5.4,-.3,.2,null,0),Ye={hero:{pos:[-20,6.5,21],look:[6,10.8,-14],shift:.1,phone:en(.66,-.1,5.8,-.5,.06,"iphone-today")},today:{pos:[-30,9,26],look:[4,2,0],shift:-.14,phone:vt},import:{pos:[-37,8,-15],look:[2,2,0],shift:.14,phone:vt},etude:{pos:[-27,5,15],look:[6,2.4,0],shift:-.14,phone:vt},hours:{pos:[-20,30,34],look:[2,0,-6],shift:.14,phone:vt},groups:{pos:[30,9,-24],look:[2,2,0],shift:-.14,phone:vt},everywhere:{pos:[-26,13,-30],look:[4,3,2],shift:.14,phone:en(-.62,-.08,5.6,.48,.06,"iphone-today")},plan:{pos:[.01,58,9],look:[2.6,0,-1],shift:0,phone:vt}};for(let t of Object.values(Ye))t.pos=Mo(t.pos),t.look=Mo(t.look);var or=new Set(["hero"]),Eo=[...document.querySelectorAll("[data-cam]")],et=[],Zt=()=>{et=Eo.map(t=>{let e=t.getBoundingClientRect();return e.top+scrollY+e.height/2})},ce=new z(...Ye.hero.pos),Xe=new z(...Ye.hero.look),Mt=ce.clone(),it=Xe.clone(),Ee=Ye.hero.shift,Yt=Ee,Le=0,qt=0,Kt={phone:{...Ye.hero.phone}},Tt={phone:{...Ye.hero.phone}},tt=t=>t*t*(3-2*t),vo=()=>W.aspect<1.05;function Qt(){et.length||Zt();let t=scrollY+innerHeight*.5,e=0;for(;e<et.length-1&&t>et[e+1];)e++;let o=Math.min(e+1,Eo.length-1),n=Eo[e].dataset.cam,r=Eo[o].dataset.cam,s=Ye[n],i=Ye[r],c=e===o?0:tt(Math.min(1,Math.max(0,(t-et[e])/(et[o]-et[e])))),a=(l,u)=>l+(u-l)*c;Mt.set(a(s.pos[0],i.pos[0]),a(s.pos[1],i.pos[1]),a(s.pos[2],i.pos[2])),it.set(a(s.look[0],i.look[0]),a(s.look[1],i.look[1]),a(s.look[2],i.look[2])),vo()&&!or.has(n)&&!or.has(r)&&Mt.sub(it).multiplyScalar(1.5).add(it),Yt=vo()?0:a(s.shift,i.shift),qt=vo()?.2:0;let f=(n==="hero"?1-c:0)+(r==="hero"?c:0);{let l=s.phone,u=i.phone,d=Tt.phone;for(let m of["x","y","d","ry","rx","on"])d[m]=a(l[m],u[m]);d.screen=(c<.5?l.screen:u.screen)??l.screen??u.screen,vo()&&Object.assign(d,{x:.3,y:.64,d:13.5,ry:-.36,rx:.08,on:f,screen:"iphone-today"})}}var rt={pos:[[-2600,8e3,-1740],[-6400,3100,1700],[-2300,640,760],[-260,150,230],[36,22,34],[31,12,-42],[-52,15,-34],[-30,17,26]],look:[[-2600,0,-1800],[-1800,0,-2300],[200,0,-480],[0,0,-5],[0,.6,-2],[0,.8,0],[0,.8,0],[0,.6,-2]],duration:14,beats:[{at:0,coords:"46,43\xB0 N \xB7 6,52\xB0 E",place:"Lac L\xE9man"},{at:.3,coords:"46,52\xB0 N \xB7 6,57\xB0 E",place:"Ecublens"},{at:.47,coords:"46,5184\xB0 N \xB7 6,5681\xB0 E",place:"Rolex Learning Center"}]},Cr=new Go(rt.pos.map(t=>new z(...Mo(t))),!1,"centripetal"),_r=new Go(rt.look.map(t=>new z(...Mo(t))),!1,"centripetal"),H={active:!So,t:0,speed:1,started:!1,beat:-1},xt=(t,e,o)=>Math.min(1,Math.max(0,(t-e)/(o-e))),ms=t=>{let e=xt(t,.06,1);return e<.5?2*e*e:1-(-2*e+2)**2/2};function cn(){H.active&&H.started?H.speed=Math.max(H.speed,rt.duration*(1-H.t)/.8):H.active&&!H.started&&scrollY>40&&(H.active=!1,yo())}for(let t of["wheel","touchstart","keydown"])addEventListener(t,cn,{passive:!0});document.querySelector("[data-skip-intro]")?.addEventListener("click",cn);var jt=document.querySelector(".intro-card"),ps=jt?.querySelector(".coords"),gs=jt?.querySelector(".place");function vs(t){H.t=Math.min(1,H.t+t*H.speed/rt.duration);let e=ms(H.t),o=Cr.getPoint(e),n=_r.getPoint(e),r=xt(e,.88,1);ce.copy(o).lerp(Mt,tt(r)),Xe.copy(n).lerp(it,tt(r)),Ee=Yt*tt(xt(e,.9,1)),Le=qt*tt(xt(e,.9,1));let s=Math.max(.02,tt(xt(e,.4,.58)));Math.abs(ye.scale.y-s)>1e-4&&(ye.scale.y=s,s>=.999&&(Be.visible=!0,Ao=!1,je())),Kt.phone.on=tt(xt(e,.93,1))*Tt.phone.on;let i=rt.beats.reduce((c,a,f)=>e>=a.at?f:c,0);if(i!==H.beat&&jt){let c=H.beat===-1;H.beat=i,jt.classList.remove("show"),setTimeout(()=>{ps.textContent=rt.beats[i].coords,gs.textContent=rt.beats[i].place,jt.classList.add("show")},c?0:380)}e>.9&&$e.classList.add("intro-done"),H.t>=1&&(H.active=!1,$e.classList.add("intro-done"),$e.classList.remove("intro"))}var Et={x:0,y:0},We={x:0,y:0};!So&&!k&&addEventListener("pointermove",t=>{Et.x=(t.clientX/innerWidth-.5)*.16,Et.y=(t.clientY/innerHeight-.5)*.1,V()},{passive:!0});function bs(t,e){let o=Math.tan(Ne.degToRad(Ve.fov/2))*e.d,n=o*W.aspect,r=(e.x-2*Ee)*n,s=(e.y-2*Le)*o-(1-e.on)*o*1.6;t.position.set(r,s,-e.d),t.rotation.set(e.rx+We.y,e.ry+We.x,0),t.visible=e.on>.01}var ke=null,Ue=null,ve=k?null:new zt(P,new Ct(1,1,{type:Ht,samples:4}));ve&&(ve.addPass(new Gt(Q,W)),ve.addPass(new Nt),ve.setPixelRatio(Wt),ve.setSize(innerWidth,innerHeight));k||import("./N8AO-7LGTPVFM.js").then(({N8AOPass:t})=>{ke=new zt(P,new Ct(1,1,{type:Ht,samples:ot<1.5?4:0})),ke.addPass(new Gt(Q,W)),Ue=new t(Q,W,innerWidth,innerHeight),Ue.configuration.aoRadius=1.6,Ue.configuration.distanceFalloff=.6,Ue.configuration.intensity=3.2,Ue.configuration.halfRes=!0,Ue.configuration.gammaCorrection=!1,Ue.setQualityMode(k?"Low":"Medium"),ke.addPass(Ue),ke.addPass(new Nt),ke.setPixelRatio(ot),ke.setSize(innerWidth,innerHeight),V()}).catch(()=>{});var fn=new Pt,kr=new Pt(!1),Pr=!0,nr=0,bo=16,rr=0,Ut=!1,Zo=!1,Ot=0;function ws(t,e,o){let n=!1;for(let r of["x","y","d","ry","rx","on"]){let s=e[r]-t[r];Math.abs(s)>1e-4&&(t[r]+=s*o,n=!0)}return n}function xs(){if(Qo=!1,!Pr||document.hidden)return;let t=Math.min(fn.getDelta(),.05),e=So?1:1-Math.exp(-t*7.5),o=!1;H.active&&H.started?(vs(Math.min(kr.getDelta(),.25)),o=!0):H.active||((ce.distanceToSquared(Mt)>1e-6||Xe.distanceToSquared(it)>1e-6)&&(ce.lerp(Mt,e),Xe.lerp(it,e),o=!0),Math.abs(Ee-Yt)+Math.abs(Le-qt)>1e-4&&(Ee+=(Yt-Ee)*e,Le+=(qt-Le)*e,o=!0),ws(Kt.phone,Tt.phone,e)&&(o=!0)),Math.abs(We.x-Et.x)+Math.abs(We.y-Et.y)>1e-4&&(We.x+=(Et.x-We.x)*e*.6,We.y+=(Et.y-We.y)*e*.6,o=!0);let n=ce.distanceTo(Xe);if(W.near=Ne.clamp(Math.min(n,ce.y)*.004,.03,40),W.far=Math.max(3e3,ce.y*45+n*4),W.updateProjectionMatrix(),W.setViewOffset(innerWidth,innerHeight,-Ee*innerWidth,Le*innerHeight,innerWidth,innerHeight),W.position.copy(ce),W.lookAt(Xe),Tt.phone.screen&&us(tr,Tt.phone.screen),ds(tr,e)&&(o=!0),bs(xe,Kt.phone),Ve.aspect=W.aspect,Ve.setViewOffset(innerWidth,innerHeight,-Ee*innerWidth,Le*innerHeight,innerWidth,innerHeight),Ve.updateProjectionMatrix(),Rr.value.set(ce.x,ce.y,-ce.z),o)Ut=!1,nt=!1,clearTimeout(Ot),Ot=0;else if(Ut&&!nt)return;let r=!o&&Zo&&ke;if(P.autoClear=!0,r?(ke.render(),Ut=!0,Zo=!1,nt=!1):o&&ve?ve.render():(P.render(Q,W),k&&!o&&(Ut=!0,nt=!1)),xe.visible&&(P.autoClear=!1,P.clearDepth(),P.render(Co,Ve)),o){let s=performance.now(),i=s-rr;rr=s,i<200&&(bo+=(i-bo)*.08,bo>24&&++nr>30&&(nr=0,bo=16,ve&&Wt>.7?(Wt=Math.max(.7,Wt-.2),ve.setPixelRatio(Wt)):!ve&&ot>1&&(ot=Math.max(1,ot-.25),P.setPixelRatio(ot),P.setSize(innerWidth,innerHeight,!1)))),V()}else!Ut&&!Ot&&(Ot=setTimeout(()=>{Ot=0,Zo=!0,V()},260))}function un(){ce.copy(Mt),Xe.copy(it),Ee=Yt,Le=qt,Object.assign(Kt.phone,Tt.phone)}function Br(){nt=!0,P.setSize(innerWidth,innerHeight,!1),ke?.setSize(innerWidth,innerHeight),ve?.setSize(innerWidth,innerHeight),W.aspect=innerWidth/innerHeight,W.updateProjectionMatrix(),Zt(),Qt(),So&&un(),V()}var sr=document.querySelector("[data-covers-slab]"),Lr=()=>{Pr=!sr||sr.getBoundingClientRect().top>0};addEventListener("scroll",()=>{Lr(),Qt(),scrollY>40&&cn(),V()},{passive:!0});addEventListener("resize",Br);addEventListener("load",()=>{Zt(),Qt(),V()});document.fonts?.ready.then(()=>{Zt(),Qt()});document.addEventListener("visibilitychange",()=>{document.hidden||(fn.getDelta(),V())});ir.addEventListener("change",()=>{Hr(),V()});Hr();Lr();W.aspect=innerWidth/innerHeight;Zt();Qt();un();Br();if(H.active&&scrollY<40&&!location.hash){$e.classList.add("intro","intro-wait"),ce.copy(Cr.getPoint(0)),Xe.copy(_r.getPoint(0)),Ee=0,Le=0,ye.scale.y=.02,Be.visible=!1,Kt.phone.on=0;let t=setTimeout(()=>{H.active=!1,yo()},1e4);Ao=!0,(k?xo:xo.then(()=>Promise.all([Ar,Er.catch(()=>{}),wr.catch(()=>{}),Sr.catch(()=>{})]))).then(async()=>{clearTimeout(t),H.active&&(await P.compileAsync(Q,W).catch(()=>{}),H.active&&(H.started=!0,$e.classList.remove("intro-wait"),fn.getDelta(),kr.start(),V()))}).catch(()=>{clearTimeout(t),H.active=!1,yo()})}else H.active=!1,yo(),xo.then(()=>V()).catch(()=>{});function yo(){ye.scale.y=1,Be.visible=!0,Ao=!1,je(),$e.classList.add("intro-done"),$e.classList.remove("intro","intro-wait"),un(),V()}
