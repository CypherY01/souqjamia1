-- Shared helpers for the app functions (task 2.1, plan/task-2.1.md).
-- All of them are internal: no grant to anyone, so only SECURITY DEFINER entry points (owned by
-- postgres) call them. Every function sets search_path = '' and qualifies every name.
-- Special characters are written as U& escapes, never typed (source-hygiene test).

-- Contract errors (item 8). SQLSTATE SJ001 carries an ErrorCode from contracts/ as the message;
-- the server (task 3.1) turns it into ApiError(code). An optional field and rule become one
-- entry of field_errors. tests/integration/db-helpers.test.ts checks that every code used in a
-- function body exists in the contract. STABLE: it changes nothing, so STABLE helpers such as
-- app.actor_id() may call it (plpgsql_check in `pnpm db:lint`).
create function app.raise_api_error(p_code text, p_field text default null, p_rule text default null)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_code is null or p_code !~ '^[A-Z][A-Z_]*$' or (p_field is null) <> (p_rule is null) then
    raise exception using errcode = 'XX000', message = 'app.raise_api_error: invalid arguments';
  end if;
  if p_field is null then
    raise exception using errcode = 'SJ001', message = p_code;
  end if;
  raise exception using
    errcode = 'SJ001',
    message = p_code,
    detail = pg_catalog.json_build_object('field', p_field, 'code', p_rule)::text;
end;
$$;
comment on function app.raise_api_error(text, text, text) is
  'Raises a contract error: SQLSTATE SJ001, message = ErrorCode, detail = {field, code} or null.';

-- Identity (DEC36, owner condition 2 on task 2.1). The server verifies the JWT signature first
-- (getClaims or equivalent, task 3.1), then sets the verified claims for this transaction only:
--   select set_config('request.jwt.claims', <claims json>, true);
-- The same setting PostgREST and Realtime use, so auth.uid() means the same in RLS policies.
-- Missing, malformed or non-member claims fail closed with UNAUTHENTICATED.
create function app.actor_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_raw text := pg_catalog.current_setting('request.jwt.claims', true);
  v_claims jsonb;
  v_sub text;
begin
  if v_raw is null or v_raw = '' then
    perform app.raise_api_error('UNAUTHENTICATED');
  end if;
  begin
    v_claims := v_raw::jsonb;
  exception when invalid_text_representation then
    perform app.raise_api_error('UNAUTHENTICATED');
  end;
  v_sub := v_claims ->> 'sub';
  if pg_catalog.jsonb_typeof(v_claims) <> 'object'
    or v_claims ->> 'role' is distinct from 'authenticated'
    or v_sub is null
    or v_sub !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform app.raise_api_error('UNAUTHENTICATED');
  end if;
  return v_sub::uuid;
end;
$$;
comment on function app.actor_id() is
  'DEC36: the verified member id (sub) for this transaction, or UNAUTHENTICATED.';

-- Time (item 5). Every function and every time column default uses app.app_now(), never the
-- built-in clock directly (checked by the comprehensive test). Here it returns the transaction
-- time only. The integration tests replace it locally with a per-connection test clock and put
-- this definition back afterwards; hosted databases never get the test version.
create function app.app_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select pg_catalog.now() $$;
comment on function app.app_now() is
  'The only source of the current time for app functions and column defaults.';

-- Text limits ("Shared input schemas", chapter 09): NFC, then trim exactly the characters that
-- JavaScript String.prototype.trim removes, like normalizeText in packages/domain/src/text.ts.
-- Plain btrim() would remove U+0020 only.
create function app.normalize_text(p text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.btrim(
    pg_catalog.normalize(p, 'NFC'),
    -- TAB LF VT FF CR SPACE NBSP, OGHAM SPACE, U+2000-U+200A, LS PS NNBSP MMSP, IDEOGRAPHIC SPACE, BOM
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  )
$$;
comment on function app.normalize_text(text) is
  'NFC and outer trim, identical to normalizeText in packages/domain (text limits, chapter 09).';

-- DEC67: the Arabic search copy (search_text, tasks 4.2 and 4.6) and the search phrase itself.
-- The stored and displayed text is never changed by this. Steps, in order:
--   1. NFKC: Arabic presentation forms and full-width letters become ordinary letters.
--   2. Latin letters to lower case.
--   3. Alef forms U+0623 U+0625 U+0622 U+0671 to U+0627; U+0649 to U+064A; U+0629 to U+0647.
--   4. Arabic-Indic and extended Arabic-Indic digits to 0-9 (as DEC50 for numeric fields).
--   5. Every space and line break to one space.
--   6. Removed: tatweel U+0640; harakat, tanween, shadda and sukun U+064B-U+0652; dagger alef
--      U+0670; invisible characters (soft hyphen, ALM, Mongolian vowel separator, zero-width
--      characters, LRM and RLM, bidi embeddings, overrides and isolates, word joiners, BOM).
--   7. Runs of spaces collapsed, ends trimmed.
-- Not changed (DEC67): U+0624, U+0626, the article "al". IMMUTABLE so a generated column and a
-- pg_trgm index can use it. Changing these rules needs a new decision and a migration that
-- recomputes the stored search copies.
create function app.search_normalize(p text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.translate(
        pg_catalog.lower(pg_catalog.normalize(p, 'NFKC')),
        -- mapped (50 characters): alef forms, alef maqsura, teh marbuta, two digit sets, spaces
        U&'\0623\0625\0622\0671\0649\0629'
          || U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669'
          || U&'\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9'
          || U&'\0009\000A\000B\000C\000D\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000'
        -- removed (no counterpart below): tatweel, diacritics, invisible characters
          || U&'\0640\064B\064C\064D\064E\064F\0650\0651\0652\0670'
          || U&'\00AD\061C\180E\200B\200C\200D\200E\200F\202A\202B\202C\202D\202E\2060\2061\2062\2063\2064\2066\2067\2068\2069\FEFF',
        U&'\0627\0627\0627\0627\064A\0647'
          || '01234567890123456789'
          || pg_catalog.repeat(' ', 24)
      ),
      ' {2,}', ' ', 'g'
    ),
    ' '
  )
$$;
comment on function app.search_normalize(text) is
  'DEC67: normalized Arabic search copy. Never applied to stored or displayed text.';
