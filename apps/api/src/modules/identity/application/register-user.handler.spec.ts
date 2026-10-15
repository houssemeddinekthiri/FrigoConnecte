import type { RegisterInput } from '@frigoconnect/contracts';
import { EmailTakenError, IdentityProvider, UserRepository } from '../domain/ports';
import { RegisterUserCommand, RegisterUserHandler } from './register-user.handler';

const input: RegisterInput = {
  email: 'a@b.fr', password: 'motdepasse-long', firstName: 'A', lastName: 'B',
  accountType: 'client', clientType: 'individual', acceptTerms: true,
};

const fakes = () => {
  const idp: jest.Mocked<IdentityProvider> = {
    createUser: jest.fn().mockResolvedValue('kc-1'),
    deleteUser: jest.fn().mockResolvedValue(undefined),
    sendVerifyEmail: jest.fn().mockResolvedValue(undefined),
    setEnabled: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn().mockResolvedValue(undefined),
  };
  const users: jest.Mocked<UserRepository> = { createWithProfile: jest.fn().mockResolvedValue(undefined) };
  return { idp, users, handler: new RegisterUserHandler(idp, users) };
};

describe('RegisterUserHandler', () => {
  it('crée Keycloak puis la base avec le même id', async () => {
    const { idp, users, handler } = fakes();
    await handler.execute(new RegisterUserCommand(input));
    expect(users.createWithProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 'kc-1', role: 'client' }));
    expect(idp.sendVerifyEmail).toHaveBeenCalledWith('kc-1');
  });

  it('email déjà pris : silencieux, rien écrit en base', async () => {
    const { idp, users, handler } = fakes();
    idp.createUser.mockRejectedValue(new EmailTakenError());
    await expect(handler.execute(new RegisterUserCommand(input))).resolves.toBeUndefined();
    expect(users.createWithProfile).not.toHaveBeenCalled();
  });

  it('échec base : supprime le compte Keycloak créé', async () => {
    const { idp, users, handler } = fakes();
    users.createWithProfile.mockRejectedValue(new Error('db down'));
    await expect(handler.execute(new RegisterUserCommand(input))).rejects.toThrow('db down');
    expect(idp.deleteUser).toHaveBeenCalledWith('kc-1');
  });
});
