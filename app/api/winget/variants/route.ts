import { NextRequest, NextResponse } from 'next/server';
import { getCatalogSource } from '@/lib/catalog';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const parentId = searchParams.get('id');

    if (!parentId || parentId.length > 200 || !/^[\w.-]+$/.test(parentId)) {
      return NextResponse.json(
        { error: 'Parameter "id" is required and must be a valid package identifier' },
        { status: 400 }
      );
    }

    const variants = await getCatalogSource().getLocaleVariants(parentId);

    return NextResponse.json({
      parentId,
      count: variants.length,
      variants,
    }, {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=600' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch locale variants' },
      { status: 500 }
    );
  }
}
