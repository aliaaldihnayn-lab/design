import * as v from 'valibot'
import { useForm } from 'vee-validate'
import { computed, type Ref } from 'vue'

import { normalizeJiraSite } from '@lawha/core/stories'
import type { useStoriesMessages } from '@lawha/vue/i18n'

import { jiraPreferences } from '@/app/integrations/jira/connection'
import { validateAfterFirstError } from '@/app/settings/validation/use'

type Messages = ReturnType<typeof useStoriesMessages>['value']

/**
 * The Jira connection form: the site and email are checked here before Jira is asked. The API
 * token is entered beside the form and never becomes part of its values.
 */
export function useJiraConnectionForm(messages: Readonly<Ref<Messages>>) {
  const schema = computed(() =>
    v.object({
      site: v.pipe(
        v.string(),
        v.trim(),
        v.check((value) => normalizeJiraSite(value) !== null, messages.value.jiraInvalidSite)
      ),
      email: v.pipe(v.string(), v.trim(), v.email(messages.value.jiraEmailInvalid)),
      projectKey: v.pipe(
        v.string(),
        v.trim(),
        v.check(
          (value) => value === '' || /^[A-Z][A-Z0-9_]*$/.test(value),
          messages.value.jiraProjectPlaceholder
        )
      )
    })
  )
  const form = useForm({
    initialValues: {
      site: jiraPreferences.value.site,
      email: jiraPreferences.value.email,
      projectKey: jiraPreferences.value.projectKey
    },
    validationSchema: schema
  })
  const [site] = form.defineField('site', validateAfterFirstError)
  const [email] = form.defineField('email', validateAfterFirstError)
  const [projectKey] = form.defineField('projectKey', validateAfterFirstError)
  return {
    fields: { site, email, projectKey },
    errors: form.errors,
    blur: (field: 'site' | 'email' | 'projectKey') => form.validateField(field),
    submit: (
      send: (values: { site: string; email: string; projectKey: string }) => Promise<void>
    ) =>
      form.handleSubmit((values) =>
        send({
          site: values.site.trim(),
          email: values.email.trim(),
          projectKey: values.projectKey.trim()
        })
      )
  }
}
