/** Redact private session grants even when stderr splits a token across chunks. */
export class SessionSecretRedactor {
  private pending = '';
  private readonly values: string[];
  constructor(secrets: readonly string[]) {
    this.values = [...new Set(secrets.filter(Boolean).flatMap(value => [value,
      JSON.stringify(value).slice(1, -1), encodeURIComponent(value)]))].sort((a, b) => b.length - a.length);
  }
  line(value: string): string {
    for (const secret of this.values) value = value.split(secret).join('[REDACTED]');
    return value;
  }
  chunk(value: string): string {
    const text = this.line(this.pending + value);
    let keep = 0;
    for (const secret of this.values) for (let size = Math.min(secret.length - 1, text.length); size > keep; size--) {
      if (text.endsWith(secret.slice(0, size))) { keep = size; break; }
    }
    this.pending = keep ? text.slice(-keep) : '';
    return keep ? text.slice(0, -keep) : text;
  }
  finish(): string {
    // An incomplete credential prefix is never useful diagnostic evidence.
    const value = this.pending ? '[REDACTED]' : ''; this.pending = ''; return value;
  }
}
