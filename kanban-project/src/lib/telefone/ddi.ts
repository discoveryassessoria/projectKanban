// src/lib/telefone/ddi.ts
// ============================================================================
// DDI POR PAÍS — tabela estática ISO 3166-1 alpha-2 → código de discagem.
//
// Os NOMES dos países vêm da base `Pais` (/api/geografia/paises, mesma chave ISO);
// o DDI não existe no banco e não ganha coluna: é um dado de padrão
// internacional (ITU-T E.164), que não muda por tenant. Cobre a lista do
// GeoNames que alimenta a base (territórios incluídos + Kosovo).
//
// Território que usa o plano da América do Norte (Bahamas, Jamaica, Porto Rico...)
// tem DDI "1": o código de área vai dentro do número, como em qualquer discagem.
// ============================================================================

export const DDI_DO_PAIS: Readonly<Record<string, string>> = {
  AD: "376", AE: "971", AF: "93", AG: "1", AI: "1", AL: "355", AM: "374", AO: "244", AQ: "672", AR: "54",
  AS: "1", AT: "43", AU: "61", AW: "297", AX: "358", AZ: "994", BA: "387", BB: "1", BD: "880", BE: "32",
  BF: "226", BG: "359", BH: "973", BI: "257", BJ: "229", BL: "590", BM: "1", BN: "673", BO: "591", BQ: "599",
  BR: "55", BS: "1", BT: "975", BV: "47", BW: "267", BY: "375", BZ: "501", CA: "1", CC: "61", CD: "243",
  CF: "236", CG: "242", CH: "41", CI: "225", CK: "682", CL: "56", CM: "237", CN: "86", CO: "57", CR: "506",
  CU: "53", CV: "238", CW: "599", CX: "61", CY: "357", CZ: "420", DE: "49", DJ: "253", DK: "45", DM: "1",
  DO: "1", DZ: "213", EC: "593", EE: "372", EG: "20", EH: "212", ER: "291", ES: "34", ET: "251", FI: "358",
  FJ: "679", FK: "500", FM: "691", FO: "298", FR: "33", GA: "241", GB: "44", GD: "1", GE: "995", GF: "594",
  GG: "44", GH: "233", GI: "350", GL: "299", GM: "220", GN: "224", GP: "590", GQ: "240", GR: "30", GS: "500",
  GT: "502", GU: "1", GW: "245", GY: "592", HK: "852", HM: "672", HN: "504", HR: "385", HT: "509", HU: "36",
  ID: "62", IE: "353", IL: "972", IM: "44", IN: "91", IO: "246", IQ: "964", IR: "98", IS: "354", IT: "39",
  JE: "44", JM: "1", JO: "962", JP: "81", KE: "254", KG: "996", KH: "855", KI: "686", KM: "269", KN: "1",
  KP: "850", KR: "82", KW: "965", KY: "1", KZ: "7", LA: "856", LB: "961", LC: "1", LI: "423", LK: "94",
  LR: "231", LS: "266", LT: "370", LU: "352", LV: "371", LY: "218", MA: "212", MC: "377", MD: "373", ME: "382",
  MF: "590", MG: "261", MH: "692", MK: "389", ML: "223", MM: "95", MN: "976", MO: "853", MP: "1", MQ: "596",
  MR: "222", MS: "1", MT: "356", MU: "230", MV: "960", MW: "265", MX: "52", MY: "60", MZ: "258", NA: "264",
  NC: "687", NE: "227", NF: "672", NG: "234", NI: "505", NL: "31", NO: "47", NP: "977", NR: "674", NU: "683",
  NZ: "64", OM: "968", PA: "507", PE: "51", PF: "689", PG: "675", PH: "63", PK: "92", PL: "48", PM: "508",
  PN: "64", PR: "1", PS: "970", PT: "351", PW: "680", PY: "595", QA: "974", RE: "262", RO: "40", RS: "381",
  RU: "7", RW: "250", SA: "966", SB: "677", SC: "248", SD: "249", SE: "46", SG: "65", SH: "290", SI: "386",
  SJ: "47", SK: "421", SL: "232", SM: "378", SN: "221", SO: "252", SR: "597", SS: "211", ST: "239", SV: "503",
  SX: "1", SY: "963", SZ: "268", TC: "1", TD: "235", TF: "262", TG: "228", TH: "66", TJ: "992", TK: "690",
  TL: "670", TM: "993", TN: "216", TO: "676", TR: "90", TT: "1", TV: "688", TW: "886", TZ: "255", UA: "380",
  UG: "256", UM: "1", US: "1", UY: "598", UZ: "998", VA: "39", VC: "1", VE: "58", VG: "1", VI: "1",
  VN: "84", VU: "678", WF: "681", WS: "685", XK: "383", YE: "967", YT: "262", ZA: "27", ZM: "260", ZW: "263",
}

/**
 * DDI compartilhado abre neste país (o usuário pode trocar): +1 → Estados Unidos,
 * +7 → Rússia, +44 → Reino Unido... Todo DDI da tabela tem exatamente um.
 */
export const PAIS_PADRAO_DO_DDI: Readonly<Record<string, string>> = (() => {
  const principais: Record<string, string> = {
    "1": "US", "7": "RU", "39": "IT", "44": "GB", "47": "NO", "61": "AU", "64": "NZ", "212": "MA",
    "262": "RE", "358": "FI", "590": "GP", "599": "CW", "672": "NF",
  }
  const saida: Record<string, string> = { ...principais }
  for (const [iso, ddi] of Object.entries(DDI_DO_PAIS)) if (!(ddi in saida)) saida[ddi] = iso
  return saida
})()

/**
 * Países cujo DDI o formatador único trata com máscara própria — vão no topo da
 * lista, nesta ordem (Brasil é o padrão do campo).
 */
export const PAISES_COM_MASCARA: readonly string[] = ["BR", "US", "CA", "PT", "ES", "IT", "DE", "FR", "AR"]

export const PAIS_PADRAO = "BR"
