export class File {
  constructor(...parts: unknown[]) {
    this.uri = parts.map(String).join('/');
  }
  uri: string;
  exists = false;
  delete() {}
}
export class Directory extends File {
  create() {}
  list() {
    return [];
  }
}
export const Paths = { cache: 'cache', document: 'document' };
