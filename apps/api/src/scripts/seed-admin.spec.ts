import { parseArgs } from './seed-admin';

describe('seed-admin : arguments', () => {
  it('accepte email, prénom et nom (nom composé)', () => {
    expect(parseArgs(['Admin@Exemple.fr', 'Marie', 'De', 'La Tour'])).toEqual({ email: 'admin@exemple.fr', firstName: 'Marie', lastName: 'De La Tour' });
  });
  it.each([[[]], [['pas-un-email', 'A', 'B']], [['a@b.fr', 'Prénom']], [['a@b.fr']]])('refuse %j', (args) => {
    expect(() => parseArgs(args as string[])).toThrow(/Usage/);
  });
});
