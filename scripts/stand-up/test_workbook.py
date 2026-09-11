import io
import unittest
import zipfile
from decimal import Decimal
from xml.etree import ElementTree as ET

from workbook import FACILITIES, HEADINGS, KEYS, LABELS, NS, WorkbookError, cell_number, parse_workbook, patch_workbook, read_sheets

MAP = {name: f"00000000-0000-4000-8000-{i:012d}" for i, name in enumerate(FACILITIES, 1)}


def fixture(blank=False, extra_sheet=False, bad_formula=False, old=False):
    rows = ['<row r="1"><c r="A1" t="inlineStr"><is><t>2026-09-07</t></is></c></row>']
    rows.append('<row r="2">' + ''.join(f'<c r="{chr(66+i)}2" t="inlineStr"><is><t>{name}</t></is></c>' for i, name in enumerate(FACILITIES)) + '</row>')
    for n, (label, key) in enumerate(LABELS.items(), 3):
        if old and n == 3:
            label = "Census"
        escaped = label.replace('&', '&amp;')
        cells = f'<c r="A{n}" t="inlineStr"><is><t>{escaped}</t></is></c>'
        for col in 'BCDEF':
            val = '100.25' if key.endswith('_cents') else '0'
            formula = '<f>1+1</f>' if bad_formula and n == 3 else ''
            cells += f'<c r="{col}{n}" s="0">{formula}' + (f'<v>{val}</v>' if not blank else '') + '</c>'
        rows.append(f'<row r="{n}">{cells}</row>')
    rows.append('<row r="25"><c r="A25" t="inlineStr"><is><t>Average Rent</t></is></c><c r="B25"><f>B3/B4</f><v>0</v></c></row>')
    content = f'<worksheet xmlns="{NS}"><sheetData>{"".join(rows)}</sheetData></worksheet>'
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as z:
        second = '<sheet name="September (NEW)" sheetId="2" r:id="r2"/>' if extra_sheet else ''
        z.writestr('xl/workbook.xml', f'<workbook xmlns="{NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="September" sheetId="1" r:id="r1"/>{second}</sheets></workbook>')
        second_rel = '<Relationship Id="r2" Target="worksheets/sheet2.xml"/>' if extra_sheet else ''
        z.writestr('xl/_rels/workbook.xml.rels', f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="worksheets/sheet1.xml"/>{second_rel}</Relationships>')
        z.writestr('xl/worksheets/sheet1.xml', content)
        if extra_sheet:
            z.writestr('xl/worksheets/sheet2.xml', content)
        z.writestr('xl/styles.xml', f'<styleSheet xmlns="{NS}"><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>')
        z.writestr('xl/media/image1.png', b'opaque-original-drawing')
    return output.getvalue()


class WorkbookTests(unittest.TestCase):
    def parse(self, raw, sheets=None):
        return parse_workbook(raw, MAP, 'approved-file-id', 'Stand Up.xlsx', sheets)

    def test_exact_numeric_mapping_cents_and_zero(self):
        result = self.parse(fixture())
        self.assertEqual(result['issues'], [])
        self.assertEqual(len(result['records']), 5)
        self.assertEqual(result['records'][0]['values']['monthly_rent_roll_cents'], 10025)
        self.assertEqual(result['records'][0]['values']['current_total_census'], 0)

    def test_empty_future_block_is_not_imported(self):
        result = self.parse(fixture(blank=True))
        self.assertEqual(result['records'], [])
        self.assertEqual(len(result['locations']), 5)
        self.assertEqual(result['issues'], [])

    def test_empty_block_duplicate_input_label_is_held_without_writable_locations(self):
        before = zipfile.ZipFile(io.BytesIO(fixture(blank=True)))
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as target:
            for name in before.namelist():
                content = before.read(name)
                if name.endswith('sheet1.xml'):
                    duplicate = b'<row r="26"><c r="A26" t="inlineStr"><is><t>Current AR</t></is></c></row>'
                    content = content.replace(b'</sheetData>', duplicate + b'</sheetData>')
                target.writestr(name, content)
        raw = buffer.getvalue()
        parsed = self.parse(raw)
        self.assertEqual(parsed['records'], [])
        self.assertEqual(len(parsed['issues']), 5)
        self.assertTrue(all(issue['code'] == 'duplicate_label' for issue in parsed['issues']))
        self.assertEqual({issue['facility_id'] for issue in parsed['issues']}, set(MAP.values()))
        self.assertTrue(all(issue['sheet'] == 'September' and issue['week_start'] == '2026-09-07' for issue in parsed['issues']))
        self.assertEqual(parsed['locations'], {})
        with self.assertRaises(WorkbookError):
            patch_workbook(raw, parsed, {MAP['Homewood'] + ':2026-09-07': dict.fromkeys(KEYS, 0)})

    def test_repeated_week_held_even_same_values(self):
        result = self.parse(fixture(extra_sheet=True))
        self.assertTrue(any(i['code'] == 'overlapping_week' for i in result['issues']))

    def test_explicit_sheet_choice_resolves_scope_not_automatic_precedence(self):
        result = self.parse(fixture(extra_sheet=True), ['September (NEW)'])
        self.assertEqual(len(result['records']), 5)
        self.assertEqual(result['issues'], [])

    def test_input_formula_held(self):
        self.assertTrue(any(i['code'] == 'invalid_input' for i in self.parse(fixture(bad_formula=True))['issues']))

    def test_input_formula_without_cached_value_is_not_a_writable_blank(self):
        parsed = self.parse(fixture(blank=True, bad_formula=True))
        self.assertEqual(parsed['records'], [])
        self.assertEqual(parsed['locations'], {})
        self.assertEqual(len(parsed['issues']), 5)
        self.assertTrue(all(issue['code'] == 'invalid_input' for issue in parsed['issues']))
        with self.assertRaises(WorkbookError):
            cell_number({'value': None, 'formula': False, 'error': True}, 'current_total_census')

    def test_legacy_does_not_reinterpret_census_as_rent(self):
        result = self.parse(fixture(old=True))
        self.assertTrue(result['issues'])
        self.assertIsNone(result['records'][0]['values']['monthly_rent_roll_cents'])

    def test_patch_preserves_other_parts_and_derived_formula(self):
        raw = fixture()
        parsed = self.parse(raw)
        values = dict.fromkeys(KEYS)
        values['monthly_rent_roll_cents'] = 123456
        values['current_total_census'] = 12
        output = patch_workbook(raw, parsed, {MAP['Homewood'] + ':2026-09-07': values})
        result = self.parse(output)
        self.assertEqual(result['records'][0]['values'], values)
        before, after = zipfile.ZipFile(io.BytesIO(raw)), zipfile.ZipFile(io.BytesIO(output))
        for name in before.namelist():
            if name not in ('xl/worksheets/sheet1.xml', 'xl/workbook.xml'):
                self.assertEqual(before.read(name), after.read(name))
        self.assertEqual(read_sheets(output)[0]['cells'][(25, 2)]['formula'], True)

    def test_empty_current_week_can_be_populated(self):
        raw = fixture(blank=True)
        parsed = self.parse(raw)
        values = dict.fromkeys(KEYS, 0)
        output = patch_workbook(raw, parsed, {MAP['Homewood'] + ':2026-09-07': values})
        self.assertEqual(len(self.parse(output)['records']), 1)

    def test_source_hash_guard(self):
        with self.assertRaises(WorkbookError):
            patch_workbook(fixture(blank=True), self.parse(fixture()), {})

    def test_invalid_numbers_and_fractional_counts(self):
        for value in ['NaN', 'Infinity', '-1', '1.5', '2147483648']:
            with self.assertRaises(WorkbookError):
                cell_number({'value': value, 'formula': False, 'error': False}, 'current_total_census')

    def test_money_precision_not_silently_rounded(self):
        with self.assertRaises(WorkbookError):
            cell_number({'value': Decimal('1.005'), 'formula': False, 'error': False}, 'monthly_rent_roll_cents')

    def test_mapping_must_be_complete_and_unambiguous(self):
        with self.assertRaises(WorkbookError):
            parse_workbook(fixture(), {'Homewood': 'x'}, 'id', 'name')

    def test_excel_ignorable_namespace_survives_patch(self):
        before = zipfile.ZipFile(io.BytesIO(fixture()))
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as target:
            for name in before.namelist():
                content = before.read(name)
                if name.endswith('sheet1.xml'):
                    content = content.replace(b'<worksheet ', b'<worksheet xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" mc:Ignorable="x14ac" ')
                target.writestr(name, content)
        raw = buffer.getvalue()
        output = patch_workbook(raw, self.parse(raw), {MAP['Homewood'] + ':2026-09-07': dict.fromkeys(KEYS, 0)})
        sheet = zipfile.ZipFile(io.BytesIO(output)).read('xl/worksheets/sheet1.xml')
        self.assertIn(b'xmlns:x14ac=', sheet)
        self.assertIn(b'Ignorable="x14ac"', sheet)
        ET.fromstring(sheet)

    def test_sparse_out_of_bounds_address_refused(self):
        from workbook import col_index
        for address in ['A9999999999', 'XFE1']:
            with self.assertRaises(WorkbookError):
                col_index(address)

    def test_boolean_cell_is_not_count_one(self):
        before = zipfile.ZipFile(io.BytesIO(fixture()))
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as target:
            for name in before.namelist():
                content = before.read(name)
                if name.endswith('sheet1.xml'):
                    content = content.replace(b'<c r="B4" s="0"><v>0</v>', b'<c r="B4" s="0" t="b"><v>1</v>')
                target.writestr(name, content)
        result = self.parse(buffer.getvalue())
        self.assertTrue(any(i['code'] == 'invalid_input' for i in result['issues']))


if __name__ == '__main__':
    unittest.main()
