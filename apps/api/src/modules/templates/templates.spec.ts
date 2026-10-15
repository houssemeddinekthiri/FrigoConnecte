import PizZip from 'pizzip';
import { fillDocx } from './templates.module';

const docx = (body: string) => {
  const z = new PizZip();
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return z.generate({ type: 'nodebuffer' });
};
const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const text = (b: Buffer) => new PizZip(b).file('word/document.xml')!.asText();

describe('fillDocx', () => {
  it('remplace les champs et répète les lignes', () => {
    const out = text(fillDocx(docx(p('Client : {{client_nom}}') + p('{{#lignes}}') + p('{{libelle}} = {{total_ligne}}') + p('{{/lignes}}')), {
      client_nom: 'Karim Benali', lignes: [{ libelle: 'Compresseur', total_ligne: '100,00 €' }, { libelle: 'Main d’œuvre', total_ligne: '50,00 €' }],
    }));
    expect(out).toContain('Client : Karim Benali');
    expect(out).toContain('Compresseur = 100,00 €');
    expect(out).toContain('Main d’œuvre = 50,00 €');
    expect(out).not.toContain('{{');
  });

  it('champ inconnu : vide, sans planter', () => {
    expect(text(fillDocx(docx(p('A{{inconnu}}B')), {}))).toContain('AB');
  });

  it('champ mal fermé ou fichier invalide : message clair', () => {
    expect(() => fillDocx(docx(p('{{client_nom')), {})).toThrow(/Modèle Word illisible/);
    expect(() => fillDocx(Buffer.from('pas un docx'), {})).toThrow(/Modèle Word illisible/);
  });
});
