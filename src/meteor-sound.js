const buffers=new WeakMap();
export function meteorSound(audio,falling) {
  const t=audio.currentTime,duration=falling ? .65 : .8;
  let buffer=buffers.get(audio);
  if(!buffer) {
    buffer=audio.createBuffer(1,audio.sampleRate,audio.sampleRate);
    const data=buffer.getChannelData(0);
    let previous=0;
    for(let i=0;i<data.length;i++) { previous=(previous+Math.random()*.08-.04)/1.02;data[i]=previous*4; }
    buffers.set(audio,buffer);
  }
  const noise=audio.createBufferSource(),filter=audio.createBiquadFilter(),gain=audio.createGain();
  noise.buffer=buffer;filter.type=falling?"bandpass":"lowpass";
  filter.frequency.setValueAtTime(falling?350:1100,t);
  filter.frequency.exponentialRampToValueAtTime(falling?1700:90,t+duration);
  filter.Q.value=.7;
  gain.gain.setValueAtTime(falling ? .001 : .075,t);
  if(falling)gain.gain.exponentialRampToValueAtTime(.035,t+.48);
  gain.gain.exponentialRampToValueAtTime(.001,t+duration);
  noise.connect(filter).connect(gain).connect(audio.destination);
  noise.start(t);noise.stop(t+duration);
  noise.onended=()=>{noise.disconnect();filter.disconnect();gain.disconnect();};
  if(falling)return;
  const bass=audio.createOscillator(),body=audio.createGain();
  bass.type="sine";bass.frequency.setValueAtTime(100,t);bass.frequency.exponentialRampToValueAtTime(28,t+.3);
  body.gain.setValueAtTime(.055,t);body.gain.exponentialRampToValueAtTime(.001,t+.5);
  bass.connect(body).connect(audio.destination);bass.start(t);bass.stop(t+.52);
  bass.onended=()=>{bass.disconnect();body.disconnect();};
}
