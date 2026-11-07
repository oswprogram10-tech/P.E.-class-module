(function (root) {
  'use strict';
  class ClassroomRepository {
    constructor(repository, vault = root.LocalVault) { this.repository = repository; this.vault = vault; }
    async load(key, revision) {
      const record = await this.repository.classroomRead(revision);
      if (!record) return { version: 0, state: root.ClassroomModel.createState() };
      const bytes = await this.vault.decrypt(record.ciphertext, record.iv, key);
      return { version: record.version, state: JSON.parse(new TextDecoder().decode(bytes)) };
    }
    async save(state, key, revision, expectedVersion, { signal, validate, clipId } = {}) {
      const bytes = new TextEncoder().encode(JSON.stringify(state));
      const encrypted = await this.vault.encrypt(bytes, key);
      signal?.throwIfAborted();
      if (validate && validate() !== true) throw new Error('작업 상태가 바뀌어 기록하지 않았어요.');
      const record = { version: expectedVersion + 1, iv: encrypted.iv, ciphertext: encrypted.ciphertext };
      await this.repository.classroomWrite(record, revision, expectedVersion, { signal, validate, clipId });
      return record.version;
    }
  }
  if (typeof module !== 'undefined') module.exports = { ClassroomRepository }; else root.ClassroomRepository = ClassroomRepository;
})(globalThis);
