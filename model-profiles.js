/* Trusted local model profiles; registration of arbitrary URLs is intentionally absent. */
(function (root) {
  'use strict';
  const Assets = typeof module !== 'undefined' && module.exports ? require('./pose-assets.js') : root.PoseAssets;
  const DEFAULT_ID = 'mediapipe-pose-lite-v1';
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const profile = freeze({ id:DEFAULT_ID, label:'MediaPipe Pose Landmarker Lite',version:Assets.version,files:Assets.files.map(file=>({...file})),output:{landmarks:33,maxPeople:1,coordinates:'normalized MediaPipe pose landmarks'},provenance:{modelSource:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',sdkLicense:'Apache-2.0',modelLicense:'Apache-2.0 per official BlazePose GHUM 3D family model card',licenseEvidence:'https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf',checkedDate:'2026-11-06',limit:'Family card does not hash-index this exact task archive; local pins are not a provider signature. See docs/pose-assets.json.'} });
  function resolve(id) { if (arguments.length !== 1 || typeof id !== 'string' || id !== DEFAULT_ID) throw new TypeError('Unknown or overridden model profile'); return profile; }
  const api = Object.freeze({DEFAULT_ID,list:()=>Object.freeze([profile]),resolve});
  if (typeof module !== 'undefined' && module.exports) module.exports=api; else root.ModelProfiles=api;
})(globalThis);
