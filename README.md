# 소상공인 보험 헤아림 — 상담사 콘솔

소상공인 고객의 업종·시설 정보로 법정 의무보험을 진단하고, 미가입·권장 보험에 당사 상품 설계(메인보장+특약)를 제안하고, 가입과 만기까지 관리하는 상담사용 웹앱입니다.

- **화면**: 정적 HTML/JS (빌드 과정 없음) → Vercel 무료 호스팅
- **로그인·DB**: Supabase 무료 플랜 (Postgres + Auth + 행 단위 보안 + 실시간 반영)
- **배포**: GitHub `main` 브랜치에 올리면 Vercel이 1~2분 안에 자동 반영

```
index.html          화면 틀과 스타일
app.js              화면 동작 (상담, 가입 트래킹, 대시보드, 관리자)
engine.js           의무보험 판정 규칙·당사 상품 정보  ← 법령·상품이 바뀌면 여기를 수정
regions.js          시·도 / 시·군·구 목록 (2026.11 기준) ← 행정구역이 바뀌면 여기를 수정
config.js           Supabase 연결 정보
supabase/schema.sql DB 테이블·권한 설정
vercel.json         보안 헤더
```

---

## 1. Supabase 준비 (최초 1회)

1. [supabase.com](https://supabase.com)에서 **New project** 생성 (Region: Northeast Asia (Seoul))
2. 왼쪽 **SQL Editor → New query**에 `supabase/schema.sql` 전체를 붙여넣고 **Run**
3. **Authentication → Sign In / Providers → Email**에서 *Allow new users to sign up*을 **끄기** (관리자만 계정을 만들도록)

## 2. 연결 정보 입력

**Project Settings → API**에서 두 값을 복사해 `config.js`에 넣습니다.

```js
window.HEARIM_CONFIG = {
  supabaseUrl: 'https://xxxx.supabase.co',
  supabaseAnonKey: 'eyJ...'   // anon public key
};
```

> anon key는 브라우저에 공개되도록 만들어진 키이고, 데이터는 `schema.sql`의 권한 규칙(RLS)으로 보호됩니다. **service_role key는 절대 넣지 마세요.**

## 3. Vercel 연결 (최초 1회)

1. [vercel.com](https://vercel.com)에 GitHub 계정으로 로그인
2. **Add New → Project →** 이 저장소 **Import**
3. Framework Preset: **Other**, Build Command: 비움, Output Directory: 비움(루트) → **Deploy**

이후에는 **`main`에 커밋이 올라갈 때마다 자동으로 운영 사이트에 반영**됩니다. 다른 브랜치나 Pull Request를 올리면 미리보기 주소가 따로 만들어져서, 반영 전에 확인할 수 있어요.

## 4. 계정 관리

**상담사 추가**: Supabase **Authentication → Users → Add user → Create new user**
이메일·비밀번호 입력, *Auto Confirm User* 체크 → 상담사 정보가 자동으로 만들어집니다. 이름·소속은 SQL Editor에서:

```sql
update profiles set name = '김하늘', branch = '서울 영업1팀'
where id = (select id from auth.users where email = 'haneul@example.com');
```

**관리자 지정** (첫 관리자는 반드시 SQL로):

```sql
update profiles set role = 'manager'
where id = (select id from auth.users where email = 'admin@example.com');
```

**퇴사·비활성화**: `update profiles set active = false where ...` (상담 기록은 유지되고 로그인만 막힘)

**비밀번호 재설정**: Authentication → Users → 해당 사용자 → *Send password recovery* 또는 비밀번호 직접 변경

## 4-1. 샘플 상담사 계정 (시연용)

1. **Authentication → Users → Add user → Create new user**
   - Email: `test@nhfire.co.kr`
   - Password: 원하는 비밀번호 (6자 이상)
   - **Auto Confirm User** 체크
2. **SQL Editor**에 `supabase/sample_counselor.sql` 전체를 붙여넣고 **Run** → 마지막 결과가 `10`이면 성공
3. 위 이메일로 로그인하면 고객 카드·가입 트래킹·대시보드에 더미 상담 10건이 보입니다.

더미 데이터를 다시 만들려면 `node scripts/gen-sample.js`를 실행한 뒤 2번을 반복하세요. 지우려면 `delete from consults where id like 'sample%';`

## 5. 권한 규칙

| 대상 | 상담사 | 관리자 |
|---|---|---|
| 본인 상담 조회·등록·수정 | ✅ | ✅ |
| 다른 상담사 상담 조회·수정 | ❌ | ✅ |
| 상담사 실적 대시보드 | 본인만 | 전체 |
| 변경 이력(audit_logs) 조회 | ❌ | ✅ |

## 6. 운영 시 유의사항

- `engine.js`의 의무보험 규칙은 **미검증 초안**입니다. 법령 원문 확인 후 `verified: true`로 바꾸세요.
- 화면에서 동의 체크를 뺐으므로, 고객 개인정보 수집·이용 동의는 **별도 절차(청약 동의서 등)로 받아야** 합니다.
- 무료 외부 클라우드입니다. **회사 보안성 심의 전에는 가상 데이터로 시범 운영**하세요.
- Supabase 무료 프로젝트는 7일간 접속이 없으면 일시정지됩니다. 대시보드에서 *Restore*로 재개하세요.
- 무료 플랜은 자동 백업이 없습니다. 주기적으로 **Database → Backups** 또는 `consults` 테이블 CSV 내보내기를 해 두세요.
