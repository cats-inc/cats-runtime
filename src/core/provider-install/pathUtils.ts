export function expandNativeEnvPath(pathValue: string): string {
  return pathValue.replace(/%([^%]+)%/g, (_match, envName: string) => (
    process.env[envName] || `%${envName}%`
  ));
}
