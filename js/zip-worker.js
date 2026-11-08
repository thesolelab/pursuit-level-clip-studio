import {ZipArchive} from './zip.js';

const archive = new ZipArchive();
self.onmessage = ({data}) => {
  try {
    if (data.type === 'add') {
      archive.add(data.filename, data.bytes);
      self.postMessage({ok: true});
    } else if (data.type === 'finish') {
      self.postMessage({blob: archive.finish()});
    } else throw Error('Unknown ZIP operation.');
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
