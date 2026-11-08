// One outstanding operation at a time keeps batch memory bounded to one raw clip.
export class ZipWorker {
  constructor() {
    this.worker = new Worker(new URL('./zip-worker.js', import.meta.url), {type: 'module'});
    this.pending = null;
    this.worker.onmessage = ({data}) => {
      const pending = this.pending;
      this.pending = null;
      if (data.error) pending?.reject(Error(data.error));
      else pending?.resolve(data.blob);
    };
    this.worker.onerror = event => {
      event.preventDefault();
      this.close(Error('ZIP packaging failed. Try exporting fewer clips.'));
    };
    this.worker.onmessageerror = () => this.close(Error('Could not read the ZIP worker response.'));
  }
  request(message, transfer = []) {
    if (!this.worker) return Promise.reject(Error('ZIP packaging was stopped.'));
    if (this.pending) return Promise.reject(Error('A ZIP operation is already in progress.'));
    return new Promise((resolve, reject) => {
      this.pending = {resolve, reject};
      try { this.worker.postMessage(message, transfer); }
      catch (error) { this.pending = null; reject(error); }
    });
  }
  add(filename, bytes) {
    return this.request({type: 'add', filename, bytes}, [bytes.buffer]);
  }
  finish() { return this.request({type: 'finish'}); }
  close(error = Error('ZIP packaging cancelled.')) {
    this.worker?.terminate();
    this.worker = null;
    this.pending?.reject(error);
    this.pending = null;
  }
}
