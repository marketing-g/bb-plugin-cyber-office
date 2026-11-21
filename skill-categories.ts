export const SKILL_CATEGORIES = [
 'research', 'writing', 'design', 'code', 'data', 'marketing', 'sales', 'documents', 'automation', 'other',
] as const;
export const SKILL_ORIGINS = ['user', 'project', 'plugin'] as const;

export type SkillCategory = typeof SKILL_CATEGORIES[number];
export type SkillOrigin = typeof SKILL_ORIGINS[number];
export interface CatalogSkill {
 name: string;
 description: string;
 origin: SkillOrigin;
 category: SkillCategory;
}

const KEYWORDS: Record<Exclude<SkillCategory, 'other'>, RegExp> = {
 research: /\b(?:research\w*|investigat\w*|interview\w*|fact check\w*|check facts|compare sources|competitor\w*|literature)\b|исследов|рес[её]рч|интервью|проверка фактов|конкурент/iu,
 writing: /\b(?:writ\w*|copywrit\w*|copy|headlines?|editing|editorial|proofread\w*|newsletter\w*|translat\w*)\b|копирайт|редактур|редактор|корректур|текст|заголов|рассылк|перевод/iu,
 design: /\b(?:design\w*|visual\w*|mockups?|illustrat\w*|typograph\w*|image\w*|posters?|figma|ux|ui|video|audio)\b|дизайн|визуал|макет|иллюстра|типограф|изображен|плакат|видео|озвуч|монтаж/iu,
 code: /\b(?:code|coding|engineer\w*|programming|debug\w*|develop\w*|software|frontend|backend|refactor\w*|unit tests?)\b|инженер|разработ|программир|(?:^|[^\p{L}])код(?:а|ом|у|е)?(?!\p{L})|отлад|рефактор|в[её]рстк/iu,
 data: /\b(?:data|analyt\w*|statistic\w*|datasets?|spreadsheets?|excel|sql|metrics?|exports?)\b|аналит|статистик|м[её]трик|таблиц|данн(?:ые|ых|ыми|ым)|выгруз|экспорт/iu,
 marketing: /\b(?:market\w*|seo|sem|strateg\w*|ads?|advertis\w*|campaign\w*|traffic|positioning|growth)\b|маркетинг|(?:^|[^\p{L}])сео(?!\p{L})|стратег|реклам|кампани|трафик|продвижен|позиционирован/iu,
 sales: /\b(?:sales|sell\w*|crm|prospect\w*|outreach|pitches|pitch|negotiat\w*|deals?)\b|продаж|переговор|сделк|лидогенерац|проспектинг/iu,
 documents: /\b(?:documents?|docs|docx|pdfs?|slides?|presentations?|reports?|minutes)\b|документ|отч[её]т|презентац|слайд|протокол/iu,
 automation: /\b(?:automat\w*|workflows?|schedul\w*|orchestrat\w*|coordinat\w*|integrat\w*|mcp)\b|автоматиз|оркестра|координ|интеграц|рабоч\p{L}* процесс|расписан/iu,
};

function keywordCategories(text: string): SkillCategory[] {
 const words = text.replace(/[-_]+/g, ' ');
 return SKILL_CATEGORIES.filter(category => category !== 'other' && KEYWORDS[category].test(words));
}

export function skillCategory(name: string, description: string): SkillCategory {
 const named = keywordCategories(name);
 const described = keywordCategories(description);
 return named.find(category => described.includes(category)) ?? named[0] ?? described[0] ?? 'other';
}

const BUILTIN_RECOMMENDATIONS: Partial<Record<string, readonly SkillCategory[]>> = {
 sherlock: ['research'], nora: ['writing'], pixel: ['design'], kadr: ['design'], bolt: ['code'],
 ada: ['data'], mark: ['marketing'], tara: ['marketing'], sema: ['marketing'], radar: ['marketing'],
 rams: ['writing', 'design', 'code', 'marketing'], stas: ['automation', 'documents'],
};
const REVIEW_WORDS = /\b(?:review\w*|criti(?:c\w*|ques?)|quality (?:check|assurance)|qa|audit\w*|acceptance)\b|проверк|ревью|критик|аудит|при[её]мк|контрол\p{L}* качеств/iu;

export function recommendSkills(skills: readonly CatalogSkill[], role: {id: string; role: string; custom?: boolean}): CatalogSkill[] {
 const categories = !role.custom && BUILTIN_RECOMMENDATIONS[role.id] || keywordCategories(role.role);
 const reviews = (!role.custom && role.id === 'rams') || REVIEW_WORDS.test(role.role);
 return skills.filter(skill => categories.includes(skill.category) ||
  (reviews && REVIEW_WORDS.test(`${skill.name} ${skill.description}`.replace(/[-_]+/g, ' '))));
}

export const skillNameKey = (name: string) => name.trim().normalize('NFC').toLowerCase();
