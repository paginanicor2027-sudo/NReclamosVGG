alter table reports add column specific_category text
  check (specific_category is null or (
    category = 'otros' and specific_category in (
      'agua', 'ambiente', 'arbolado', 'cableado', 'cloacas', 'comercios', 'educacion',
      'electricidad', 'espacios_publicos', 'gas', 'plagas', 'salud', 'seguridad',
      'tramites', 'transito', 'veredas'
    )
  ));

create index reports_public_display_category_order_idx
  on reports (coalesce(specific_category, category), created_at desc, request_id desc)
  where status in ('published', 'in_progress', 'resolved');
