import { describe, expect, it, vi } from 'vitest';
import { isDockerContainerRunning } from './dockerDiscovery.js';

describe('isDockerContainerRunning', () => {
  it('returns true when docker inspect reports the container is running', async () => {
    await expect(isDockerContainerRunning(
      'cats-cli-dev',
      vi.fn(async () => ({
        code: 0,
        stdout: 'true\n',
        stderr: '',
      })),
    )).resolves.toBe(true);
  });

  it('returns false when docker inspect reports the container is stopped', async () => {
    await expect(isDockerContainerRunning(
      'cats-cli-dev',
      vi.fn(async () => ({
        code: 0,
        stdout: 'false\n',
        stderr: '',
      })),
    )).resolves.toBe(false);
  });

  it('throws when docker inspect fails', async () => {
    await expect(isDockerContainerRunning(
      'cats-cli-dev',
      vi.fn(async () => ({
        code: 1,
        stdout: '',
        stderr: 'No such container: cats-cli-dev',
      })),
    )).rejects.toThrow('No such container: cats-cli-dev');
  });
});
