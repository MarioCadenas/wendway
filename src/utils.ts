export function replaceTemplate(template: string, replacement: Record<string, string>) {
    let newTemplate = template;

    Object
        .entries(replacement)
        .forEach(([key, value]) => {
            newTemplate = newTemplate.replaceAll(new RegExp(`{{${key}}}`, 'gm'), value)
        });

    return newTemplate;
}